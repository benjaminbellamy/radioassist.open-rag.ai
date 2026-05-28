import { useEffect, useRef, useState } from 'react'
import WaveSurfer from 'wavesurfer.js'
import { Play, Pause, Square, X } from 'lucide-react'

interface Props {
  src: string
  title: string
  onClose: () => void
}

function timecode(t: number): string {
  if (!Number.isFinite(t) || t < 0) t = 0
  const total = Math.floor(t)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

function cssVar(name: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback
}

/** Broadcast-studio audio strip: amber square-bar waveform + transport + timecode. */
export function AudioPlayer({ src, title, onClose }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const wsRef = useRef<WaveSurfer | null>(null)
  const [ready, setReady] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [current, setCurrent] = useState(0)
  const [duration, setDuration] = useState(0)

  useEffect(() => {
    if (!containerRef.current) return
    setReady(false)
    setPlaying(false)
    setCurrent(0)
    setDuration(0)

    const ws = WaveSurfer.create({
      container: containerRef.current,
      height: 56,
      waveColor: cssVar('--accent', '#f0c419'),
      progressColor: cssVar('--accent-hover', '#ffd633'),
      cursorColor: cssVar('--accent', '#f0c419'),
      cursorWidth: 1,
      barWidth: 2,
      barGap: 1,
      barRadius: 0,
      normalize: true,
    })
    wsRef.current = ws

    ws.on('ready', () => {
      setReady(true)
      setDuration(ws.getDuration())
    })
    ws.on('timeupdate', (t: number) => setCurrent(t))
    ws.on('play', () => setPlaying(true))
    ws.on('pause', () => setPlaying(false))
    ws.on('finish', () => setPlaying(false))

    // Load separately so the abort on unmount/src-change is swallowed
    // (destroying mid-load otherwise raises an unhandled AbortError).
    ws.load(src).catch(() => {})

    return () => {
      wsRef.current = null
      ws.destroy()
    }
  }, [src])

  return (
    <div className="player">
      <div className="player__transport">
        <button
          className="player__btn"
          onClick={() => wsRef.current?.playPause()}
          disabled={!ready}
          title={playing ? 'Pause' : 'Lecture'}
        >
          {playing ? <Pause size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" />}
        </button>
        <button
          className="player__btn"
          onClick={() => {
            wsRef.current?.stop()
            setPlaying(false)
          }}
          disabled={!ready}
          title="Arrêter"
        >
          <Square size={13} fill="currentColor" />
        </button>
      </div>

      <div className="player__main">
        <div className="player__title" title={title}>
          {title}
        </div>
        <div ref={containerRef} className="player__wave" />
      </div>

      <div className="player__time">
        {timecode(current)} / {timecode(duration)}
      </div>

      <button className="player__close" onClick={onClose} title="Fermer le lecteur">
        <X size={16} />
      </button>
    </div>
  )
}
