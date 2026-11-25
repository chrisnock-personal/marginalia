/** Helpers for translating between repo-relative asset paths and Markdown links. */

export function isRepoRelativeSrc(src: string): boolean {
  return Boolean(src) && !/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(src)
}

function relativeFrom(fromDir: string, target: string): string {
  const from = fromDir.split('/').filter(Boolean)
  const to = target.split('/').filter(Boolean)
  let shared = 0
  while (shared < from.length && shared < to.length && from[shared] === to[shared]) shared += 1
  const parts = [...from.slice(shared).map(() => '..'), ...to.slice(shared)]
  return parts.join('/') || (to.at(-1) ?? '')
}

/** Path relative to the Markdown file: docs/guide.md + docs/assets/a.png -> assets/a.png. */
export function relativeSrcFor(docPath: string, repoPath: string): string {
  const dir = docPath.includes('/') ? docPath.slice(0, docPath.lastIndexOf('/')) : ''
  return relativeFrom(dir, repoPath)
}

/** Resolve a Markdown image src back to a repo-relative path, or null for external URLs. */
export function repoPathFor(docPath: string, src: string): string | null {
  if (!isRepoRelativeSrc(src)) return null
  const dir = docPath.includes('/') ? docPath.slice(0, pathSlashIndex(docPath) + 1) : ''
  try {
    return decodeURIComponent(new URL(src, `https://marginalia.local/${dir}`).pathname.slice(1))
  } catch {
    return null
  }
}

function pathSlashIndex(path: string): number {
  return path.lastIndexOf('/')
}

function normalize(url: string): string {
  const withoutQuery = url.split(/[?#]/, 1)[0]
  try {
    return decodeURIComponent(withoutQuery.replace(/^\.\//, ''))
  } catch {
    return withoutQuery.replace(/^\.\//, '')
  }
}

function encodeUrlPath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/')
}

function aliasIndex(aliases: string[], url: string): number {
  const clean = normalize(url)
  return aliases.findIndex((alias) => clean === alias || clean === `/${alias}`)
}

/**
 * Rewrite references to an image in one Markdown document. With `newPath: null`
 * image embeds are removed and links become plain text. Handles inline
 * Markdown links/images, reference definitions and raw HTML <img> tags.
 */
export function rewriteReferences(
  markdown: string,
  docPath: string,
  oldRepoPath: string,
  newRepoPath: string | null,
): string {
  const from = [oldRepoPath, `/${oldRepoPath}`, relativeSrcFor(docPath, oldRepoPath)]
  const to = newRepoPath
    ? [newRepoPath, `/${newRepoPath}`, relativeSrcFor(docPath, newRepoPath)]
    : null

  // [label](url) and ![alt](url), preserving the surrounding syntax.
  let result = markdown.replace(
    /(!?\[[^\]]*\]\(\s*<?)([^)\s>]+)(>?(?:\s+["'][^"']*["'])?\s*\))/g,
    (full, prefix: string, url: string, suffix: string) => {
      const index = aliasIndex(from, url)
      if (index < 0) return full
      if (to) return `${prefix}${encodeUrlPath(to[index])}${suffix}`
      if (prefix.startsWith('!')) return ''
      return prefix.slice(prefix.indexOf('[') + 1, prefix.lastIndexOf(']'))
    },
  )

  // Reference-style definitions: [id]: url
  result = result.replace(
    /^(\s*\[[^\]]+\]:[ \t]*<?)([^)\s>]+)(>?(?:\s+["'][^"']*["'])?[ \t]*)$/gm,
    (full, prefix: string, url: string, suffix: string) => {
      const index = aliasIndex(from, url)
      return index < 0 ? full : to ? `${prefix}${encodeUrlPath(to[index])}${suffix}` : ''
    },
  )

  // Raw HTML images.
  result = result.replace(
    /(<img\b[^>]*\bsrc\s*=\s*["'])([^"']+)(["'][^>]*>)/gi,
    (full, prefix: string, url: string, suffix: string) => {
      const index = aliasIndex(from, url)
      if (index < 0) return full
      return to ? `${prefix}${encodeUrlPath(to[index])}${suffix}` : ''
    },
  )

  return newRepoPath ? result : result.replace(/\n{3,}/g, '\n\n')
}
