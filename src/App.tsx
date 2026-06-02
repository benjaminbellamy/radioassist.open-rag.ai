import { useCallback, useEffect, useRef, useState } from 'react'
import { Eraser } from 'lucide-react'
import {
  assetUrl,
  clearPrompts,
  deletePrompt,
  fetchPartitions,
  getPrompts,
  savePrompt,
  streamChat,
  type ApiMessage,
} from './api'
import type { ChatMessage, Source } from './types'
import { mediaKind } from './media'
import { PartitionSelect } from './components/PartitionSelect'
import { Composer } from './components/Composer'
import { MessageItem } from './components/MessageItem'
import { SourceViewer } from './components/SourceViewer'
import { AudioPlayer } from './components/AudioPlayer'

const newId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2)

const sourceName = (s: Source) => s.original_filename ?? s.filename ?? 'document'
const isAudio = (s: Source) => !!s.file_url && mediaKind(sourceName(s)) === 'audio'

export default function App() {
  const [partitions, setPartitions] = useState<string[]>([])
  const [partition, setPartition] = useState('')
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [busy, setBusy] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [activeSource, setActiveSource] = useState<Source | null>(null)
  const [activeAudio, setActiveAudio] = useState<Source | null>(null)
  const [prompts, setPrompts] = useState<string[]>([])
  const [lastPrompt, setLastPrompt] = useState<string | null>(null)

  const abortRef = useRef<AbortController | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  // --- Typewriter smoothing ---------------------------------------------
  // Upstream SSE deltas can arrive in big, uneven chunks (and a buffering
  // reverse proxy makes it worse), so appending them directly looks jerky —
  // paragraph by paragraph. Instead we queue incoming text and reveal it at a
  // steady per-frame cadence so it always types out smoothly, letter by letter.
  const pendingRef = useRef('')
  const rafRef = useRef<number | null>(null)
  const streamDoneRef = useRef(false)

  useEffect(() => {
    fetchPartitions()
      .then((list) => {
        setPartitions(list)
        setPartition((cur) => cur || list[0] || '')
      })
      .catch((err) => setLoadError(String(err)))
    getPrompts()
      .then(setPrompts)
      .catch(() => {})
  }, [])

  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages])

  const updateLast = useCallback(
    (fn: (m: ChatMessage) => ChatMessage) =>
      setMessages((prev) => {
        if (prev.length === 0) return prev
        const next = prev.slice()
        next[next.length - 1] = fn(next[next.length - 1])
        return next
      }),
    [],
  )

  const drain = useCallback(() => {
    const pending = pendingRef.current
    if (pending.length === 0) {
      if (streamDoneRef.current) {
        rafRef.current = null
        updateLast((m) => (m.streaming ? { ...m, streaming: false } : m))
        return
      }
      rafRef.current = requestAnimationFrame(drain)
      return
    }
    // Reveal a few chars per frame; speed up when the backlog is large so we
    // never fall far behind, but still animate single characters near the end.
    const n = Math.max(1, Math.ceil(pending.length / 10))
    pendingRef.current = pending.slice(n)
    updateLast((m) => ({ ...m, content: m.content + pending.slice(0, n) }))
    rafRef.current = requestAnimationFrame(drain)
  }, [updateLast])

  const resetStream = useCallback(() => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    rafRef.current = null
    pendingRef.current = ''
    streamDoneRef.current = true
  }, [])

  const send = useCallback(
    async (text: string) => {
      if (!partition || busy) return
      const history: ApiMessage[] = messages
        .filter((m) => !m.error && m.content.trim() !== '')
        .map((m) => ({ role: m.role, content: m.content }))
      const apiMessages: ApiMessage[] = [...history, { role: 'user', content: text }]

      setMessages((prev) => [
        ...prev,
        { id: newId(), role: 'user', content: text },
        { id: newId(), role: 'assistant', content: '', streaming: true },
      ])
      setLastPrompt(text)
      setBusy(true)
      const controller = new AbortController()
      abortRef.current = controller

      // Arm the typewriter: queue is empty, more is coming, frame loop runs.
      pendingRef.current = ''
      streamDoneRef.current = false
      if (rafRef.current === null) rafRef.current = requestAnimationFrame(drain)

      try {
        await streamChat({
          partition,
          messages: apiMessages,
          signal: controller.signal,
          onToken: (t) => {
            pendingRef.current += t
          },
          onSources: (s) => {
            updateLast((m) => ({ ...m, sources: s }))
            // Surface the answer's first audio source in the player strip.
            const audio = s.find(isAudio)
            if (audio) setActiveAudio(audio)
          },
        })
      } catch (err) {
        if (!controller.signal.aborted) {
          // Drop any buffered text and show the error in its place.
          pendingRef.current = ''
          updateLast((m) => ({
            ...m,
            content: m.content || `⚠️ ${String(err)}`,
            error: !m.content,
          }))
        }
      } finally {
        // Let the drain loop type out whatever is still queued, then it clears
        // the `streaming` flag once the queue empties.
        streamDoneRef.current = true
        setBusy(false)
        abortRef.current = null
      }
    },
    [partition, busy, messages, updateLast, drain],
  )

  const stop = useCallback(() => {
    abortRef.current?.abort()
    pendingRef.current = '' // halt the typewriter immediately on user stop
  }, [])

  const openSource = useCallback((s: Source) => {
    if (isAudio(s)) setActiveAudio(s)
    else setActiveSource(s)
  }, [])

  const handleSavePrompt = useCallback((t: string) => {
    savePrompt(t).then(setPrompts).catch(() => {})
  }, [])
  const handleDeletePrompt = useCallback((t: string) => {
    deletePrompt(t).then(setPrompts).catch(() => {})
  }, [])
  const handleClearPrompts = useCallback(() => {
    clearPrompts().then(setPrompts).catch(() => {})
  }, [])

  function clearPage() {
    abortRef.current?.abort()
    resetStream()
    setMessages([])
    setActiveAudio(null)
    setActiveSource(null)
  }

  function changePartition(p: string) {
    abortRef.current?.abort()
    resetStream()
    setPartition(p)
    setMessages([])
    setActiveAudio(null)
    setActiveSource(null)
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar__brand">
          <span className="topbar__logo" />
          <span className="topbar__title">Open-RAG.ai</span>
          <a
            className="topbar__source"
            href="https://github.com/linagora/radioassist.open-rag.ai"
            target="_blank"
            rel="noreferrer"
            title="Logiciel libre — code source (AGPL-3.0)"
          >
            AGPLv3
          </a>
          <button
            className="topbar__clear"
            onClick={clearPage}
            disabled={messages.length === 0 && !activeAudio && !activeSource}
            title="Effacer la page"
          >
            <Eraser size={15} />
          </button>
        </div>
        <PartitionSelect
          partitions={partitions}
          value={partition}
          disabled={busy}
          onChange={changePartition}
        />
      </header>

      {activeAudio?.file_url && (
        <AudioPlayer
          key={activeAudio.file_url}
          src={assetUrl(activeAudio.file_url)}
          title={sourceName(activeAudio)}
          onClose={() => setActiveAudio(null)}
        />
      )}

      <main className="output" ref={scrollRef}>
        {loadError ? (
          <div className="empty empty--error">
            <p>Connexion impossible à la base documentaire.</p>
            <code>{loadError}</code>
          </div>
        ) : messages.length === 0 ? (
          <div className="empty">
            <h1>Assistant documentaire</h1>
            <p>
              Interrogez la base <strong>{partition || '…'}</strong> en langage naturel. Les
              réponses citent leurs sources.
            </p>
          </div>
        ) : (
          <div className="output__inner">
            {messages.map((m) => (
              <MessageItem key={m.id} message={m} onOpenSource={openSource} />
            ))}
          </div>
        )}
      </main>

      <footer className="composer-bar">
        <Composer
          busy={busy}
          disabled={!partition || !!loadError}
          prompts={prompts}
          lastPrompt={lastPrompt}
          onSend={send}
          onStop={stop}
          onSavePrompt={handleSavePrompt}
          onDeletePrompt={handleDeletePrompt}
          onClearPrompts={handleClearPrompts}
        />
      </footer>

      <SourceViewer source={activeSource} onClose={() => setActiveSource(null)} />
    </div>
  )
}
