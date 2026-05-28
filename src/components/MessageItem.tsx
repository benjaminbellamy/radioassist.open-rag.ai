import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { ChatMessage, Source } from '../types'

interface Props {
  message: ChatMessage
  onOpenSource: (source: Source) => void
}

/** De-duplicate sources by file + page so the citation row stays tidy. */
function uniqueSources(sources: Source[]): Source[] {
  const seen = new Set<string>()
  const out: Source[] = []
  for (const s of sources) {
    const key = `${s.filename ?? s.file_url ?? ''}#${s.page ?? ''}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(s)
  }
  return out
}

export function MessageItem({ message, onOpenSource }: Props) {
  if (message.role === 'user') {
    return (
      <div className="msg msg--user">
        <div className="msg__user-text">{message.content}</div>
      </div>
    )
  }

  const sources = message.sources ? uniqueSources(message.sources) : []

  return (
    <div className="msg msg--assistant">
      <div className={`msg__assistant${message.error ? ' msg__assistant--error' : ''}`}>
        <div className="msg__markdown">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
          {message.streaming && <span className="caret" />}
        </div>

        {sources.length > 0 && (
          <div className="citations">
            <span className="citations__label">Sources</span>
            {sources.map((s, i) => {
              const name = s.original_filename ?? s.filename ?? 'document'
              const label = typeof s.page === 'number' ? `${name} · p.${s.page}` : name
              return (
                <button
                  key={`${name}-${s.page ?? i}`}
                  className="cite"
                  title={label}
                  onClick={() => onOpenSource(s)}
                >
                  [{i + 1}]
                </button>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
