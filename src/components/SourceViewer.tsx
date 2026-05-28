import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import type { Source } from '../types'
import { assetUrl, extractId } from '../api'
import { mediaKind } from '../media'

interface Props {
  source: Source | null
  onClose: () => void
}

/** Build the player for whichever media type the source is. */
function Player({ source }: { source: Source }) {
  const name = source.original_filename ?? source.filename ?? ''
  const kind = mediaKind(name)
  if (!source.file_url) return <p className="viewer__empty">Fichier source indisponible.</p>
  const url = assetUrl(source.file_url)

  switch (kind) {
    case 'pdf':
      return (
        <iframe
          className="viewer__media viewer__media--pdf"
          title={name}
          src={source.page ? `${url}#page=${source.page}` : url}
        />
      )
    case 'audio':
      return <audio className="viewer__media" controls preload="metadata" src={url} />
    case 'video':
      return <video className="viewer__media viewer__media--video" controls preload="metadata" src={url} />
    case 'image':
      return <img className="viewer__media viewer__media--image" alt={name} src={url} />
    default:
      return (
        <div className="viewer__download">
          <p>Aperçu non disponible pour ce type de fichier.</p>
          <a href={url} target="_blank" rel="noreferrer" download>
            Télécharger {name}
          </a>
        </div>
      )
  }
}

export function SourceViewer({ source, onClose }: Props) {
  const [snippet, setSnippet] = useState<string | null>(null)

  useEffect(() => {
    if (!source) return
    setSnippet(null)
    const id = extractId(source.chunk_url)
    if (!id) return
    let cancelled = false
    fetch(`/api/extract/${id}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { page_content?: string } | null) => {
        if (!cancelled && d?.page_content) setSnippet(d.page_content)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [source])

  useEffect(() => {
    if (!source) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [source, onClose])

  if (!source) return null
  const name = source.original_filename ?? source.filename ?? 'Source'

  return (
    <div className="viewer-overlay" onClick={onClose}>
      <aside className="viewer" onClick={(e) => e.stopPropagation()}>
        <header className="viewer__header">
          <div className="viewer__title">
            <strong>{name}</strong>
            {typeof source.page === 'number' && <span className="viewer__page">page {source.page}</span>}
          </div>
          <button className="viewer__close" onClick={onClose} title="Fermer">
            <X size={16} />
          </button>
        </header>

        <div className="viewer__body">
          <Player source={source} />
          {snippet && (
            <details className="viewer__snippet" open>
              <summary>Extrait cité</summary>
              <p>{snippet}</p>
            </details>
          )}
        </div>
      </aside>
    </div>
  )
}
