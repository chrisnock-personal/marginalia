/** Types shared by the browser client and the API server. */

export type ProviderId = 'local' | 'github'

export interface ProviderInfo {
  id: ProviderId
  label: string
  configured: boolean
  detail?: string
  oauthConfigured?: boolean
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

/** A comment attached to an image rather than a text range. */
export interface ImageTarget {
  type: 'image'
  /** Repo-relative path of the image, e.g. docs/assets/photo.png. */
  path: string
}

export interface Comment {
  id: string
  path: string
  /** Text comments carry an anchor; image comments carry `target` instead. */
  anchor?: CommentAnchor
  target?: ImageTarget
  body: string
  author: string
  createdAt: string
  resolved: boolean
  /** When set, this comment is a reply to another comment in the same file. */
  parentId?: string
}

export interface CommentsFile {
  version: 1
  comments: Comment[]
}

export interface FileChange {
  path: string
  content: string
  /** base64 for binary assets such as pasted images; defaults to utf8. */
  encoding?: 'utf8' | 'base64'
  /** Remove this path in the published branch; content is ignored. */
  delete?: boolean
}

export interface PublishRequest {
  provider: ProviderId
  repo: string
  baseRef?: string
  /** Head SHA seen when the document was opened; publishing fails if it moved. */
  baseSha?: string
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
