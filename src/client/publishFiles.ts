import { DEFAULT_COMMENTS_PATH, serializeComments } from '../shared/comments'
import type { CommentsFile, FileChange } from '../shared/types'

export type PublishFileStatus = 'added' | 'edited' | 'moved' | 'deleted' | 'comments'

/** One row in the publish dialog, backed by the exact change sent to the API. */
export interface PublishFileRow {
  change: FileChange
  status: PublishFileStatus
  /** For a move, the other path in the pair. */
  pairPath?: string
  commentCount?: number
}

interface PublishFilesInput {
  path: string
  markdown: string
  original: string
  docEdits: Record<string, string>
  assets: FileChange[]
  comments: CommentsFile
}

/**
 * Match an added base64 asset with a deleted asset holding the same bytes.
 * A rename stages the new path with its bytes and deletes the old path, so
 * equal bytes identify a move without changing the changes sent to the API.
 */
function findMovePairs(assets: FileChange[]) {
  const additions = assets.filter((asset) => !asset.delete)
  const deletions = assets.filter((asset) => asset.delete)
  const deletedByAdd = new Map<FileChange, FileChange>()
  const addedByDelete = new Map<FileChange, FileChange>()
  const usedDeletes = new Set<FileChange>()

  for (const addition of additions) {
    if (addition.encoding !== 'base64') continue
    const deleted = deletions.find((entry) =>
      !usedDeletes.has(entry) && entry.path !== addition.path && entry.content === addition.content)
    if (!deleted) continue
    usedDeletes.add(deleted)
    deletedByAdd.set(addition, deleted)
    addedByDelete.set(deleted, addition)
  }
  return { deletedByAdd, addedByDelete }
}

/** Build the single file list used by both the publish request and the dialog. */
export function buildPublishFiles({
  path,
  markdown,
  original,
  docEdits,
  assets,
  comments,
}: PublishFilesInput): PublishFileRow[] {
  const files: PublishFileRow[] = []
  if (path && markdown !== original) {
    files.push({ change: { path, content: markdown }, status: 'edited' })
  }
  for (const [filePath, content] of Object.entries(docEdits)) {
    files.push({ change: { path: filePath, content }, status: 'edited' })
  }

  const { deletedByAdd, addedByDelete } = findMovePairs(assets)
  for (const asset of assets) {
    const added = addedByDelete.get(asset)
    if (added) {
      files.push({ change: asset, status: 'deleted', pairPath: added.path })
      continue
    }
    const deleted = deletedByAdd.get(asset)
    if (deleted) {
      files.push({ change: asset, status: 'moved', pairPath: deleted.path })
      continue
    }
    files.push({ change: asset, status: asset.delete ? 'deleted' : 'added' })
  }

  files.push({
    change: { path: DEFAULT_COMMENTS_PATH, content: serializeComments(comments) },
    status: 'comments',
    commentCount: comments.comments.length,
  })
  return files
}
