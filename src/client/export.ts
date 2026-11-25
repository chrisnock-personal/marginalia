import type { Comment, FileChange, ProviderId } from '../shared/types'
import { isRepoRelativeSrc, repoPathFor } from './assetPaths'

export interface ExportOptions {
  title: string
  /** HTML produced by Tiptap's getHTML(). */
  html: string
  comments: Comment[]
  includeComments: boolean
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] ?? char,
  )
}

const IMAGE_MIME_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  avif: 'image/avif',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
}

/** Build a self-contained image URL from base64 bytes and the asset's extension. */
export function imageDataUrl(path: string, base64: string): string {
  const extension = path.split(/[?#]/, 1)[0].split('.').pop()?.toLowerCase() ?? ''
  const payload = base64.startsWith('data:') ? base64.slice(base64.indexOf(',') + 1) : base64
  return `data:${IMAGE_MIME_TYPES[extension] ?? 'image/png'};base64,${payload}`
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return btoa(binary)
}

export type ImageSourceResolver = (
  src: string,
) => string | null | undefined | Promise<string | null | undefined>

/**
 * Replace every <img src> with whatever the resolver returns (typically a data
 * URL). Unresolvable sources are left untouched so one bad image cannot break
 * the whole export.
 */
export async function inlineImageSources(html: string, resolve: ImageSourceResolver): Promise<string> {
  const pattern = /(<img\b[^>]*\bsrc\s*=\s*)(["'])([^"']+)\2/gi
  const replacements = await Promise.all(
    [...html.matchAll(pattern)].map(async (match) => {
      const [full, prefix, quote, src] = match
      try {
        const resolved = await resolve(src)
        return resolved ? `${prefix}${quote}${resolved}${quote}` : full
      } catch {
        return full
      }
    }),
  )
  let index = 0
  return html.replace(pattern, () => replacements[index++])
}

const HTML_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'",
}

function decodeSrc(src: string): string {
  return src.replace(/&(amp|lt|gt|quot|#39);/g, (full, entity: string) => HTML_ENTITIES[entity] ?? full)
}

export interface ResolveImageSourceOptions {
  docPath: string
  provider: ProviderId
  repoId: string
  baseRef?: string
  /** Staged/renamed images whose bytes are only available in the browser. */
  assets: FileChange[]
  /** Reverse lookup from an editor blob preview to its Markdown src. */
  previewToSrc: (url: string) => string | undefined
  /** Read base-ref bytes for an image that is not staged. */
  assetBase64: (provider: ProviderId, repo: string, assetPath: string, ref?: string) => Promise<string>
  /** Fetch external image bytes; defaults to the browser's fetch. */
  fetchBytes?: (url: string) => Promise<ArrayBuffer>
}

function apiAssetLocation(src: string, options: ResolveImageSourceOptions): { path: string; ref?: string } | null {
  let url: URL
  try {
    url = new URL(src, typeof window === 'undefined' ? 'http://marginalia.local/' : window.location.href)
  } catch {
    return null
  }
  const match = url.pathname.match(/^\/api\/repos\/([^/]+)\/([^/]+)\/asset$/)
  if (!match || match[1] !== options.provider || decodeURIComponent(match[2]) !== options.repoId) return null
  const path = url.searchParams.get('path')
  if (!path) return null
  return { path, ref: url.searchParams.get('ref') ?? options.baseRef }
}

async function defaultFetchBytes(url: string): Promise<ArrayBuffer> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return response.arrayBuffer()
}

/**
 * Resolve one editor image src to a data URL. Returns null when the source
 * cannot be read, so the caller keeps the original URL instead of breaking the
 * export.
 */
export async function resolveExportImageSource(
  src: string,
  options: ResolveImageSourceOptions,
): Promise<string | null> {
  const decoded = decodeSrc(src)
  if (decoded.startsWith('data:')) return src

  let repoPath: string | null = null
  let ref = options.baseRef
  const apiLocation = apiAssetLocation(decoded, options)
  if (apiLocation) {
    repoPath = apiLocation.path
    ref = apiLocation.ref
  } else if (decoded.startsWith('blob:')) {
    const previewSrc = options.previewToSrc(decoded)
    repoPath = previewSrc ? repoPathFor(options.docPath, previewSrc) : null
  } else if (isRepoRelativeSrc(decoded)) {
    repoPath = repoPathFor(options.docPath, decoded)
  }

  if (repoPath) {
    try {
      const staged = options.assets.find(
        (asset) => asset.path === repoPath && !asset.delete && asset.encoding === 'base64',
      )
      const base64 = staged?.content ?? await options.assetBase64(options.provider, options.repoId, repoPath, ref)
      return imageDataUrl(repoPath, base64)
    } catch {
      return null
    }
  }

  if (/^(?:https?:)?\/\//i.test(decoded)) {
    try {
      const fetchBytes = options.fetchBytes ?? defaultFetchBytes
      return imageDataUrl(decoded, bytesToBase64(new Uint8Array(await fetchBytes(decoded))))
    } catch {
      return null
    }
  }

  return null
}

function commentsHtml(comments: Comment[]): string {
  if (!comments.length) return '<p class="empty">No comments in this document.</p>'
  return comments.map((comment) => {
    const anchor = comment.target?.type === 'image'
      ? `<p class="anchor">Image: ${escapeHtml(comment.target.path)}</p>`
      : comment.anchor
        ? `<blockquote>${escapeHtml(comment.anchor.quote)}</blockquote>`
        : ''
    return `<article class="comment${comment.resolved ? ' resolved' : ''}">
      ${anchor}
      <p>${escapeHtml(comment.body)}</p>
      <p class="meta">${escapeHtml(comment.author)} · ${escapeHtml(new Date(comment.createdAt).toLocaleString())}</p>
    </article>`
  }).join('\n')
}

export function buildExportHtml({ title, html, comments, includeComments }: ExportOptions): string {
  const appendix = includeComments
    ? `<section class="comments"><h2>Comments</h2>${commentsHtml(comments)}</section>`
    : ''
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
  @page { size: A4; margin: 18mm 16mm; }
  body { font: 14px/1.6 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; color: #1f2430; max-width: 850px; margin: 0 auto; padding: 24px; }
  h1, h2, h3 { line-height: 1.25; break-after: avoid; }
  img { max-width: 100%; height: auto; display: block; margin: 12px 0; break-inside: avoid; }
  table { border-collapse: collapse; width: 100%; margin: 12px 0; break-inside: avoid; }
  th, td { border: 1px solid #cbd2df; padding: 6px 9px; text-align: left; vertical-align: top; }
  th { background: #f2f4f8; }
  pre { background: #f5f6f9; border: 1px solid #e0e4ec; border-radius: 6px; padding: 10px; white-space: pre-wrap; }
  blockquote { border-left: 3px solid #c7d0e6; margin-left: 0; padding-left: 12px; color: #5d6578; }
  .comments { margin-top: 32px; break-before: page; }
  .comment { border: 1px solid #dfe3ea; border-radius: 6px; padding: 10px 12px; margin-bottom: 10px; break-inside: avoid; }
  .comment.resolved { opacity: .65; }
  .comment p { margin: 4px 0; }
  .anchor, .meta, .empty { color: #737b8c; font-size: 12px; }
  a { color: #2440a8; }
  @media print { body { padding: 0; max-width: none; } }
</style>
</head>
<body>
<main>${html}</main>
${appendix}
</body>
</html>
`
}

/** Open the print tab synchronously so a popup blocker still allows it. */
export function printHtml(html: string | Promise<string>): Promise<void> {
  const win = window.open('', '_blank')
  if (!win) throw new Error('Allow pop-ups to open the print view')
  win.document.open()
  win.document.write('<!doctype html><title>Preparing export…</title><p>Preparing export…</p>')
  win.document.close()
  win.focus()
  return Promise.resolve(html).then(
    (content) => {
      win.document.open()
      win.document.write(content)
      win.document.close()
      win.setTimeout(() => win.print(), 300)
    },
    (error: unknown) => {
      win.close()
      throw error
    },
  )
}

export function downloadHtml(filename: string, html: string): void {
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename.endsWith('.html') ? filename : `${filename}.html`
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}
