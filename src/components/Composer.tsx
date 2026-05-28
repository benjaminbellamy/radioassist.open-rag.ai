import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { Send, Square, Trash2 } from 'lucide-react'

interface Props {
  busy: boolean
  disabled?: boolean
  prompts: string[]
  lastPrompt: string | null
  onSend: (text: string) => void
  onStop: () => void
  onSavePrompt: (text: string) => void
  onDeletePrompt: (text: string) => void
  onClearPrompts: () => void
}

type Mode = 'none' | 'search' | 'save' | 'clear'

const truncate = (s: string, n = 64) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

/**
 * Prompt field with a slash command-palette for saved demo prompts:
 *   /        browse + filter saved prompts (↑/↓, Enter recalls into the input,
 *            Delete or the trash icon removes one)
 *   /+       save the last sent prompt
 *   /--      delete all saved prompts
 */
export function Composer({
  busy,
  disabled,
  prompts,
  lastPrompt,
  onSend,
  onStop,
  onSavePrompt,
  onDeletePrompt,
  onClearPrompts,
}: Props) {
  const [text, setText] = useState('')
  const [highlight, setHighlight] = useState(0)
  const taRef = useRef<HTMLTextAreaElement>(null)

  // Derive command mode from the current input.
  let mode: Mode = 'none'
  let query = ''
  if (text === '/+') mode = 'save'
  else if (text === '/--') mode = 'clear'
  else if (text.startsWith('/')) {
    mode = 'search'
    query = text.slice(1).toLowerCase()
  }

  const filtered = mode === 'search' ? prompts.filter((p) => p.toLowerCase().includes(query)) : []
  const idx = Math.min(highlight, Math.max(filtered.length - 1, 0))

  // Keep the highlight in range as the filter changes.
  useEffect(() => setHighlight(0), [text])

  function autoGrow() {
    const el = taRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`
  }

  function submit() {
    const value = text.trim()
    if (!value || busy || disabled) return
    onSend(value)
    setText('')
    requestAnimationFrame(autoGrow)
  }

  function recall(p: string) {
    setText(p)
    requestAnimationFrame(() => {
      const el = taRef.current
      if (el) {
        el.focus()
        el.setSelectionRange(p.length, p.length)
        autoGrow()
      }
    })
  }

  function saveLast() {
    if (lastPrompt && !prompts.includes(lastPrompt)) onSavePrompt(lastPrompt)
    setText('')
  }

  function clearAll() {
    onClearPrompts()
    setText('')
  }

  function deleteOne(p: string) {
    onDeletePrompt(p)
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Escape' && mode !== 'none') {
      e.preventDefault()
      setText('')
      return
    }
    if (mode === 'search') {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setHighlight(Math.min(idx + 1, filtered.length - 1))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setHighlight(Math.max(idx - 1, 0))
      } else if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        if (filtered[idx]) recall(filtered[idx])
      } else if (e.key === 'Delete') {
        e.preventDefault()
        if (filtered[idx]) deleteOne(filtered[idx])
      }
      return
    }
    if (mode === 'save') {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        saveLast()
      }
      return
    }
    if (mode === 'clear') {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        clearAll()
      }
      return
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      submit()
    }
  }

  const saveHint = !lastPrompt
    ? 'Aucun prompt récent à enregistrer'
    : prompts.includes(lastPrompt)
      ? `Déjà enregistré : « ${truncate(lastPrompt)} »`
      : `Entrée ↵ pour enregistrer : « ${truncate(lastPrompt)} »`

  const clearHint =
    prompts.length === 0
      ? 'Aucun prompt enregistré'
      : `Entrée ↵ pour supprimer les ${prompts.length} prompt(s) enregistré(s)`

  return (
    <div className="composer">
      {mode !== 'none' && (
        <div className="cmd">
          {mode === 'search' &&
            (filtered.length === 0 ? (
              <div className="cmd__empty">
                {prompts.length === 0
                  ? 'Aucun prompt enregistré — tapez /+ pour enregistrer le dernier'
                  : 'Aucun résultat'}
              </div>
            ) : (
              <ul className="cmd__list">
                {filtered.map((p, i) => (
                  <li
                    key={p}
                    className={`cmd__row${i === idx ? ' cmd__row--active' : ''}`}
                    onMouseEnter={() => setHighlight(i)}
                    onClick={() => recall(p)}
                  >
                    <span className="cmd__text">{p}</span>
                    <button
                      className="cmd__del"
                      title="Supprimer (Suppr)"
                      onClick={(e) => {
                        e.stopPropagation()
                        deleteOne(p)
                      }}
                    >
                      <Trash2 size={14} />
                    </button>
                  </li>
                ))}
              </ul>
            ))}
          {mode === 'search' && (
            <div className="cmd__legend">↵ rappeler · Suppr supprimer · /+ enregistrer · /-- tout effacer</div>
          )}
          {mode === 'save' && <div className="cmd__hint">{saveHint}</div>}
          {mode === 'clear' && <div className="cmd__hint">{clearHint}</div>}
        </div>
      )}

      <textarea
        ref={taRef}
        className="composer__input"
        placeholder={disabled ? 'Sélectionnez une base documentaire…' : 'Posez votre question…   ( / pour vos prompts )'}
        rows={1}
        value={text}
        disabled={disabled}
        onChange={(e) => {
          setText(e.target.value)
          autoGrow()
        }}
        onKeyDown={onKeyDown}
      />
      {busy ? (
        <button className="composer__send" onClick={onStop} title="Arrêter">
          <Square size={15} fill="currentColor" />
        </button>
      ) : (
        <button
          className="composer__send"
          onClick={submit}
          disabled={disabled || !text.trim() || mode !== 'none'}
          title="Envoyer"
        >
          <Send size={16} />
        </button>
      )}
    </div>
  )
}
