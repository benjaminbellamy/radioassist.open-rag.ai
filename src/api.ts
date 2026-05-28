import type { Source } from './types'

export interface ApiMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
}

/** Fetch the partitions to show in the selection listbox. */
export async function fetchPartitions(): Promise<string[]> {
  const r = await fetch('/api/partitions')
  if (!r.ok) throw new Error(`Impossible de charger les partitions (${r.status})`)
  const data = (await r.json()) as { partitions?: string[] }
  return data.partitions ?? []
}

interface StreamChatOptions {
  partition: string
  messages: ApiMessage[]
  signal?: AbortSignal
  onToken: (text: string) => void
  onSources: (sources: Source[]) => void
}

/**
 * POST to our proxy and consume the OpenAI-style SSE stream.
 * Tokens arrive in `choices[0].delta.content`; the final chunk carries the RAG
 * sources in `extra` (a JSON string) before the terminating `[DONE]`.
 */
export async function streamChat(opts: StreamChatOptions): Promise<void> {
  const res = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ partition: opts.partition, messages: opts.messages }),
    signal: opts.signal,
  })
  if (!res.ok || !res.body) {
    const msg = await res.text().catch(() => '')
    throw new Error(msg || `Erreur du serveur (${res.status})`)
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed.startsWith('data:')) continue
      const payload = trimmed.slice(5).trim()
      if (payload === '[DONE]') return

      let chunk: {
        choices?: { delta?: { content?: string } }[]
        extra?: unknown
      }
      try {
        chunk = JSON.parse(payload)
      } catch {
        continue
      }

      const delta = chunk.choices?.[0]?.delta?.content
      if (delta) opts.onToken(delta)

      const extra = chunk.extra
      if (extra && extra !== '{}') {
        try {
          const parsed = typeof extra === 'string' ? JSON.parse(extra) : extra
          const sources = (parsed as { sources?: Source[] })?.sources
          if (sources?.length) opts.onSources(sources)
        } catch {
          /* ignore malformed extra */
        }
      }
    }
  }
}

// ----- Saved demo prompts -----

async function promptsResult(r: Response): Promise<string[]> {
  if (!r.ok) throw new Error(`prompts ${r.status}`)
  return ((await r.json()) as { prompts?: string[] }).prompts ?? []
}

export function getPrompts(): Promise<string[]> {
  return fetch('/api/prompts').then(promptsResult)
}

export function savePrompt(text: string): Promise<string[]> {
  return fetch('/api/prompts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  }).then(promptsResult)
}

export function deletePrompt(text: string): Promise<string[]> {
  return fetch('/api/prompts/delete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  }).then(promptsResult)
}

export function clearPrompts(): Promise<string[]> {
  return fetch('/api/prompts/clear', { method: 'POST' }).then(promptsResult)
}

/** Rewrite an OpenRAG file URL to our authenticated proxy. */
export function assetUrl(fileUrl: string): string {
  return `/api/asset?u=${encodeURIComponent(fileUrl)}`
}

/** Pull the chunk id out of a chunk_url like http://host/extract/<id>. */
export function extractId(chunkUrl?: string): string | undefined {
  if (!chunkUrl) return undefined
  return chunkUrl.match(/\/extract\/([^/?#]+)/)?.[1]
}
