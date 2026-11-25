/**
 * Unpublished Markdown is kept per file, keyed by repo-relative path. The open
 * document is a mirror of `docEdits[path]`; keeping one map means switching
 * files, staging images and publishing several pages all use the same state.
 */

/** Store `content` for `path`, or drop the entry when it matches the base text. */
export function updateDocEdit(
  edits: Record<string, string>,
  filePath: string,
  content: string,
  base: string,
): Record<string, string> {
  if (content === base) {
    const { [filePath]: _unchanged, ...rest } = edits
    return rest
  }
  if (edits[filePath] === content) return edits
  return { ...edits, [filePath]: content }
}
