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
  /** Every unpublished Markdown file, including the one currently open. */
  docEdits: Record<string, string>
  assets: FileChange[]
  /** New path -> original path for staged moves (client-side only). */
  movedFrom?: Record<string, string>
  comments: CommentsFile
}

/**
 * Pair each staged move (new path -> original path) with its added and deleted
 * entries. A pair is shown only when both entries are still staged.
 */
function findMovePairs(assets: FileChange[], movedFrom: Record<string, string>) {
  const deletedByAdd = new Map<FileChange, FileChange>()
  const addedByDelete = new Map<FileChange, FileChange>()
  for (const [newPath, oldPath] of Object.entries(movedFrom)) {
    const added = assets.find((asset) => asset.path === newPath && !asset.delete)
    const deleted = assets.find((asset) => asset.path === oldPath && asset.delete)
    if (!added || !deleted || added === deleted) continue
    deletedByAdd.set(added, deleted)
    addedByDelete.set(deleted, added)
  }
  return { deletedByAdd, addedByDelete }
}

/** Build the single file list used by both the publish request and the dialog. */
export function buildPublishFiles({
  docEdits,
  assets,
  movedFrom = {},
  comments,
}: PublishFilesInput): PublishFileRow[] {
  const files: PublishFileRow[] = []
  for (const [filePath, content] of Object.entries(docEdits)) {
    files.push({ change: { path: filePath, content }, status: 'edited' })
  }

  const { deletedByAdd, addedByDelete } = findMovePairs(assets, movedFrom)
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
