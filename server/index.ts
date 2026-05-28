// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Linagora

import express from 'express'
import { Readable } from 'node:stream'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Load .env (Node >= 20.12). In production the vars may already be in the
// environment, so a missing file is not fatal.
try {
  process.loadEnvFile()
} catch {
  /* env provided by the environment */
}

const BASE = (process.env.OPENRAG_API_URL ?? 'https://demo.open-rag.ai').replace(/\/+$/, '')
const TOKEN = process.env.OPENRAG_API_TOKEN ?? ''
const PORT = Number(process.env.PORT ?? 8787)
// Bind to loopback by default so only a local reverse proxy (Caddy) can reach
// it. Set HOST=0.0.0.0 only if you deliberately want it exposed.
const HOST = process.env.HOST ?? '127.0.0.1'
const BASE_HOST = new URL(BASE).host
const ALLOWLIST = (process.env.OPENRAG_PARTITIONS ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)

if (!TOKEN) {
  console.error('Missing OPENRAG_API_TOKEN. Copy .env.example to .env and set it.')
  process.exit(1)
}

const authHeaders = { Authorization: `Bearer ${TOKEN}` }

/** Readable error string that keeps fetch's underlying `cause` (ECONN*, TLS…). */
function describeError(err: unknown): string {
  if (err instanceof Error) {
    const cause = (err as { cause?: unknown }).cause
    const detail =
      cause instanceof Error
        ? (cause as { code?: string }).code ?? cause.message
        : cause
    return detail ? `${err.message} (${String(detail)})` : err.message
  }
  return String(err)
}

// Saved demo prompts, persisted to a JSON file (array of unique strings).
const PROMPTS_FILE = path.resolve(process.cwd(), process.env.PROMPTS_FILE ?? 'data/prompts.json')

async function readPrompts(): Promise<string[]> {
  try {
    const parsed = JSON.parse(await readFile(PROMPTS_FILE, 'utf8'))
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

async function writePrompts(list: string[]): Promise<void> {
  await mkdir(path.dirname(PROMPTS_FILE), { recursive: true })
  await writeFile(PROMPTS_FILE, JSON.stringify(list, null, 2))
}

const app = express()
app.use(express.json({ limit: '1mb' }))

/** Partitions that populate the selection listbox. */
app.get('/api/partitions', async (_req, res) => {
  try {
    const r = await fetch(`${BASE}/partition/`, { headers: authHeaders })
    if (!r.ok) {
      res.status(r.status).json({ error: `partitions: ${r.status}` })
      return
    }
    const data = (await r.json()) as { partitions?: { partition: string }[] }
    let list = (data.partitions ?? []).map((p) => p.partition)
    if (ALLOWLIST.length) list = list.filter((p) => ALLOWLIST.includes(p))
    list.sort((a, b) => a.localeCompare(b))
    res.json({ partitions: list })
  } catch (err) {
    res.status(502).json({ error: String(err) })
  }
})

/** Chat completion. We force streaming and pipe the SSE straight to the client. */
app.post('/api/chat', async (req, res) => {
  const { partition, messages, temperature } = req.body ?? {}
  if (!partition || !Array.isArray(messages)) {
    res.status(400).json({ error: 'partition and messages are required' })
    return
  }
  try {
    const upstream = await fetch(`${BASE}/v1/chat/completions`, {
      method: 'POST',
      headers: { ...authHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: `openrag-${partition}`,
        messages,
        stream: true,
        ...(typeof temperature === 'number' ? { temperature } : {}),
      }),
    })
    if (!upstream.ok || !upstream.body) {
      const text = await upstream.text().catch(() => '')
      res.status(upstream.status || 502).json({ error: text || 'upstream error' })
      return
    }
    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache, no-transform')
    res.setHeader('Connection', 'keep-alive')
    res.flushHeaders?.()
    const nodeStream = Readable.fromWeb(upstream.body as Parameters<typeof Readable.fromWeb>[0])
    nodeStream.on('error', (e) => {
      console.error('[chat] stream error:', e)
      res.end()
    })
    req.on('close', () => nodeStream.destroy())
    nodeStream.pipe(res)
  } catch (err) {
    console.error('[chat] fetch error:', err)
    if (!res.headersSent) res.status(502).json({ error: describeError(err) })
    else res.end()
  }
})

/** Chunk text snippet (the passage the answer was grounded on). */
app.get('/api/extract/:id', async (req, res) => {
  try {
    const r = await fetch(`${BASE}/extract/${encodeURIComponent(req.params.id)}`, {
      headers: authHeaders,
    })
    res.status(r.status)
    const ct = r.headers.get('content-type')
    if (ct) res.setHeader('Content-Type', ct)
    res.send(Buffer.from(await r.arrayBuffer()))
  } catch (err) {
    res.status(502).json({ error: String(err) })
  }
})

const PASSTHROUGH_HEADERS = [
  'content-type',
  'content-length',
  'content-range',
  'accept-ranges',
  'cache-control',
  'last-modified',
  'etag',
]

/**
 * Proxy a source file (PDF/audio/video/image). The browser passes the original
 * `file_url` as ?u=...; we validate the host/path, append the token as a query
 * param (the only auth scheme /static accepts) and stream the bytes back. The
 * Range header is forwarded so audio/video seeking works.
 */
app.get('/api/asset', async (req, res) => {
  const raw = String(req.query.u ?? '')
  let target: URL
  try {
    target = new URL(raw)
  } catch {
    res.status(400).end('bad url')
    return
  }
  if (target.host !== BASE_HOST || !/^\/static\//.test(target.pathname)) {
    res.status(403).end('forbidden')
    return
  }
  try {
    const url = new URL(`${BASE}${target.pathname}`)
    url.search = target.search
    url.searchParams.set('token', TOKEN)
    const headers: Record<string, string> = {}
    if (req.headers.range) headers.Range = String(req.headers.range)
    const upstream = await fetch(url, { headers })
    res.status(upstream.status)
    for (const h of PASSTHROUGH_HEADERS) {
      const v = upstream.headers.get(h)
      if (v) res.setHeader(h, v)
    }
    if (!upstream.body) {
      res.end()
      return
    }
    const nodeStream = Readable.fromWeb(upstream.body as Parameters<typeof Readable.fromWeb>[0])
    nodeStream.on('error', () => res.end())
    req.on('close', () => nodeStream.destroy())
    nodeStream.pipe(res)
  } catch (err) {
    console.error('[asset] fetch error:', err)
    if (!res.headersSent) res.status(502).end(describeError(err))
    else res.end()
  }
})

// ----- Saved demo prompts -----
app.get('/api/prompts', async (_req, res) => {
  res.json({ prompts: await readPrompts() })
})

app.post('/api/prompts', async (req, res) => {
  const text = String(req.body?.text ?? '').trim()
  if (!text) {
    res.status(400).json({ error: 'text required' })
    return
  }
  const list = await readPrompts()
  if (!list.includes(text)) {
    list.push(text)
    await writePrompts(list)
  }
  res.json({ prompts: list })
})

app.post('/api/prompts/delete', async (req, res) => {
  const text = String(req.body?.text ?? '')
  const list = (await readPrompts()).filter((p) => p !== text)
  await writePrompts(list)
  res.json({ prompts: list })
})

app.post('/api/prompts/clear', async (_req, res) => {
  await writePrompts([])
  res.json({ prompts: [] })
})

app.get('/api/health', (_req, res) => res.json({ ok: true }))

// Unknown API routes must 404 as JSON, not fall through to the SPA catch-all.
app.use('/api', (_req, res) => res.status(404).json({ error: 'not found' }))

// In production, serve the built SPA and let client-side routing fall back.
if (process.env.NODE_ENV === 'production') {
  const dir = path.dirname(fileURLToPath(import.meta.url))
  const dist = path.join(dir, '..', 'dist')
  app.use(express.static(dist))
  app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')))
}

app.listen(PORT, HOST, () => {
  console.log(`OpenRAG proxy listening on http://${HOST}:${PORT} -> ${BASE}`)
})
