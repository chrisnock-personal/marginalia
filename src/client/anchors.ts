import type { Node as PMNode } from '@tiptap/pm/model'
import type { CommentAnchor } from '../shared/types'

const CONTEXT = 40

interface IndexedText {
  text: string
  /** positions[i] is the ProseMirror document position of text[i]. */
  positions: number[]
}

/** Flatten a document into plain text, keeping a map back to document positions. */
export function indexDocument(doc: PMNode): IndexedText {
  let text = ''
  const positions: number[] = []
  doc.descendants((node, pos) => {
    if (node.isText) {
      const value = node.text ?? ''
      for (let i = 0; i < value.length; i += 1) {
        text += value[i]
        positions.push(pos + i)
      }
    } else if (node.isTextblock && text.length > 0 && !text.endsWith('\n')) {
      text += '\n'
      positions.push(pos)
    }
  })
  return { text, positions }
}

export function anchorFromSelection(doc: PMNode, from: number, to: number): CommentAnchor | null {
  if (to <= from) return null
  const { text, positions } = indexDocument(doc)
  const offsetByPosition = new Map<number, number>()
  positions.forEach((position, offset) => {
    if (!offsetByPosition.has(position)) offsetByPosition.set(position, offset)
  })
  const start = offsetByPosition.get(from)
  const endChar = offsetByPosition.get(to - 1) ?? offsetByPosition.get(to)
  if (start === undefined || endChar === undefined) return null
  const end = endChar + 1
  const quote = text.slice(start, end)
  if (!quote.trim()) return null
  return {
    quote,
    prefix: text.slice(Math.max(0, start - CONTEXT), start),
    suffix: text.slice(end, end + CONTEXT),
    start,
    end,
  }
}

/** Find an anchored quote again after edits: offset hint, then context, then quote. */
export function resolveAnchor(
  doc: PMNode,
  anchor: CommentAnchor,
): { from: number; to: number } | null {
  if (!anchor.quote) return null
  const { text, positions } = indexDocument(doc)
  const candidates: number[] = []
  if (text.slice(anchor.start, anchor.start + anchor.quote.length) === anchor.quote) {
    candidates.push(anchor.start)
  }
  const contextual = `${anchor.prefix}${anchor.quote}${anchor.suffix}`
  const contextAt = text.indexOf(contextual)
  if (contextAt >= 0) candidates.push(contextAt + anchor.prefix.length)
  const quoteAt = text.indexOf(anchor.quote)
  if (quoteAt >= 0) candidates.push(quoteAt)

  for (const at of candidates) {
    const from = positions[at]
    const last = positions[at + anchor.quote.length - 1]
    if (from !== undefined && last !== undefined) return { from, to: last + 1 }
  }
  return null
}
