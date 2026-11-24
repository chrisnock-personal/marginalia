/** Types shared by the browser client and the API server. */

export type ProviderId = 'local' | 'github'

export interface ProviderInfo {
  id: ProviderId
  label: string
  configured: boolean
  detail?: string
}

export interface RepoSummary {
  provider: ProviderId
  /** Opaque id used in API paths: alias for local repos, owner/name for GitHub. */
  id: string
  fullName: string
  description?: string
  defaultBranch?: string
}

export interface FileEntry {
  path: string
  type: 'blob' | 'tree'
}

/**
 * Anchors are offsets into the editor's plain text (the rendered document,
 * with block separators). `quote` plus `prefix`/`suffix` allow re-anchoring
 * after small edits; offsets are only a hint.
 */
export interface CommentAnchor {
  quote: string
  prefix: string
  suffix: string
  start: number
  end: number
}

export interface Comment {
  id: string
  path: string
  anchor: CommentAnchor
  body: string
  author: string
  createdAt: string
  resolved: boolean
}

export interface CommentsFile {
  version: 1
  comments: Comment[]
}

export interface FileChange {
  path: string
  content: string
}

export interface PublishRequest {
  provider: ProviderId
  repo: string
  baseRef?: string
  branch: string
  commitMessage: string
  files: FileChange[]
  comments: CommentsFile
  commentsPath?: string
  pr?: { title: string; body: string }
}

export interface PublishResult {
  branch: string
  commit?: string
  pushed: boolean
  prUrl?: string
  notes: string[]
}
