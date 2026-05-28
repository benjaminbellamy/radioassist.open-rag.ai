export type MediaKind = 'pdf' | 'audio' | 'video' | 'image' | 'other'

export function extensionOf(name?: string): string {
  if (!name) return ''
  const clean = name.split(/[?#]/)[0]
  return (clean.split('.').pop() ?? '').toLowerCase()
}

export function mediaKind(name?: string): MediaKind {
  const ext = extensionOf(name)
  if (ext === 'pdf') return 'pdf'
  if (['mp3', 'wav', 'flac', 'ogg', 'aac', 'wma', 'm4a'].includes(ext)) return 'audio'
  if (['mp4', 'webm', 'mov', 'flv', 'm4v', 'ogv'].includes(ext)) return 'video'
  if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'avif'].includes(ext)) return 'image'
  return 'other'
}
