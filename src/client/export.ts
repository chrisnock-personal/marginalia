import type { Comment } from '../shared/types'

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

/** Standalone HTML opened in a new tab needs absolute image URLs. */
export function absolutizeImageSources(html: string, baseUrl: string): string {
  return html.replace(/(<img\b[^>]*\bsrc\s*=\s*)(["'])([^"']+)\2/gi, (full, prefix: string, quote: string, src: string) => {
    try {
      return `${prefix}${quote}${new URL(src, baseUrl).href}${quote}`
    } catch {
      return full
    }
  })
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
  const baseUrl = typeof window === 'undefined' ? 'http://marginalia.local/' : window.location.href
  const body = absolutizeImageSources(html, baseUrl)
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
<main>${body}</main>
${appendix}
</body>
</html>
`
}

export function printHtml(html: string): void {
  const win = window.open('', '_blank')
  if (!win) throw new Error('Allow pop-ups to open the print view')
  win.document.open()
  win.document.write(html)
  win.document.close()
  win.focus()
  win.setTimeout(() => win.print(), 300)
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
