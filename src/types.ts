export interface Source {
  source_type?: string
  file_url?: string
  chunk_url?: string
  filename?: string
  original_filename?: string
  page?: number
  chunk_type?: string
  relevance_score?: number
  file_id?: string
  partition?: string
  file_size?: string
}

export type Role = 'user' | 'assistant'

export interface ChatMessage {
  id: string
  role: Role
  content: string
  sources?: Source[]
  streaming?: boolean
  error?: boolean
}
