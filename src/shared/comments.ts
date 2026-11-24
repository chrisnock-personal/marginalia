import type { Comment, CommentsFile } from './types'

export const DEFAULT_COMMENTS_PATH = 'comments.json'

export function emptyComments(): CommentsFile {
  return { version: 1, comments: [] }
}

export function serializeComments(file: CommentsFile): string {
  return `${JSON.stringify(file, null, 2)}\n`
}

/** Validate an untrusted comments.json and normalise optional fields. */
export function parseComments(raw: string): CommentsFile {
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    throw new Error('comments.json is not valid JSON')
  }
  if (!value || typeof value !== 'object') throw new Error('comments.json must be an object')
  const file = value as Partial<CommentsFile>
  if (file.version !== 1 || !Array.isArray(file.comments)) {
    throw new Error('comments.json must have { "version": 1, "comments": [...] }')
  }
  return {
    version: 1,
    comments: file.comments.map((rawComment: Partial<Comment>, index: number): Comment => {
      const a = rawComment.anchor
      if (
        !rawComment ||
        typeof rawComment.id !== 'string' ||
        typeof rawComment.path !== 'string' ||
        typeof rawComment.body !== 'string' ||
        typeof rawComment.author !== 'string' ||
        typeof rawComment.createdAt !== 'string' ||
        typeof rawComment.resolved !== 'boolean' ||
        !a ||
        typeof a.quote !== 'string' ||
        typeof a.prefix !== 'string' ||
        typeof a.suffix !== 'string' ||
        !Number.isInteger(a.start) ||
        !Number.isInteger(a.end)
      ) {
        throw new Error(`comments.json comment #${index + 1} is invalid`)
      }
      return rawComment as Comment
    }),
  }
}

export function newCommentId(): string {
  return `c_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}
