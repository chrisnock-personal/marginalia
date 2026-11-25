/**
 * Keep Markdown table formatting stable across editor round-trips.
 *
 * Tiptap's table renderer pads each column to the longest cell and emits a
 * leading newline, so serialising a document turns compact GFM tables into
 * wide ones and adds blank lines around them. When a table is semantically
 * unchanged we put the original text back verbatim; when it really changed we
 * emit compact GFM instead of Tiptap's padded output.
 */

interface TableBlock {
  start: number
  end: number
  lines: string[]
  signature: string
}

function isBlank(line: string): boolean {
  return line.trim() === ''
}

/** Find a closing backtick run of exactly the same length as the opening one. */
function closingBackticks(line: string, start: number, length: number): number {
  let index = start + length
  while (index < line.length) {
    if (line[index] !== '`') {
      index += 1
      continue
    }
    let run = 0
    while (index + run < line.length && line[index + run] === '`') run += 1
    if (run === length) return index
    index += run
  }
  return -1
}

/**
 * Split on real column separators only: escaped pipes and pipes inside code
 * spans are cell content and must survive unchanged.
 */
function splitOnPipes(text: string): string[] {
  const cells: string[] = []
  let current = ''
  let index = 0
  while (index < text.length) {
    if (text[index] === '\\' && index + 1 < text.length) {
      current += text.slice(index, index + 2)
      index += 2
      continue
    }
    if (text[index] === '`') {
      let run = 0
      while (index + run < text.length && text[index + run] === '`') run += 1
      const close = closingBackticks(text, index, run)
      if (close >= 0) {
        current += text.slice(index, close + run)
        index = close + run
      } else {
        current += text.slice(index, index + run)
        index += run
      }
      continue
    }
    if (text[index] === '|') {
      cells.push(current)
      current = ''
      index += 1
      continue
    }
    current += text[index]
    index += 1
  }
  cells.push(current)
  return cells
}

function isEscaped(text: string, index: number): boolean {
  let backslashes = 0
  for (let i = index - 1; i >= 0 && text[i] === '\\'; i -= 1) backslashes += 1
  return backslashes % 2 === 1
}

/** Split a table row into trimmed cells, ignoring optional outer pipes. */
function splitCells(line: string): string[] {
  let body = line.trim()
  if (body.startsWith('|')) body = body.slice(1)
  if (body.endsWith('|') && !isEscaped(body, body.length - 1)) body = body.slice(0, -1)
  return splitOnPipes(body).map((cell) => cell.trim())
}

type Alignment = 'none' | 'left' | 'right' | 'center'

function alignmentOf(cell: string): Alignment | null {
  const text = cell.trim()
  if (!/^:?-+:?$/.test(text)) return null
  const left = text.startsWith(':')
  const right = text.endsWith(':')
  if (left && right) return 'center'
  if (left) return 'left'
  if (right) return 'right'
  return 'none'
}

function isDelimiterRow(line: string): boolean {
  const cells = splitCells(line)
  return cells.length > 0 && cells.every((cell) => alignmentOf(cell) !== null)
}

function isTableRow(line: string): boolean {
  return !isBlank(line) && splitCells(line).length > 1
}

function fenceMarker(line: string): string | null {
  return /^\s*(`{3,}|~{3,})/.exec(line)?.[1] ?? null
}

/** Compare rows/cells and alignment, ignoring padding and escape style. */
function canonicalCell(cell: string): string {
  return cell.trim().replace(/\\\|/g, '|')
}

function signatureOf(lines: string[]): string {
  const rows = lines.map(splitCells)
  return JSON.stringify({
    header: rows[0].map(canonicalCell),
    align: rows[1].map((cell) => alignmentOf(cell)),
    body: rows.slice(2).map((row) => row.map(canonicalCell)),
  })
}

function findTableBlocks(lines: string[]): TableBlock[] {
  const blocks: TableBlock[] = []
  let fence: string | null = null
  for (let index = 0; index < lines.length; index += 1) {
    const marker = fenceMarker(lines[index])
    if (marker) {
      if (!fence) fence = marker
      else if (marker[0] === fence[0] && marker.length >= fence.length) fence = null
      continue
    }
    if (fence || index === 0 || !isDelimiterRow(lines[index])) continue
    if (!isTableRow(lines[index - 1])) continue
    if (splitCells(lines[index - 1]).length !== splitCells(lines[index]).length) continue

    let end = index + 1
    while (end < lines.length && isTableRow(lines[end]) && !isDelimiterRow(lines[end])) end += 1
    const blockLines = lines.slice(index - 1, end)
    blocks.push({ start: index - 1, end, lines: blockLines, signature: signatureOf(blockLines) })
    index = end
  }
  return blocks
}

function blankCounts(lines: string[], start: number, end: number): { leading: number; trailing: number } {
  let leading = 0
  while (start - leading - 1 >= 0 && isBlank(lines[start - leading - 1])) leading += 1
  let trailing = 0
  while (end + trailing < lines.length && isBlank(lines[end + trailing])) trailing += 1
  return { leading, trailing }
}

/**
 * Tiptap's serializer may drop the file's final newline. Match the source's
 * convention: add exactly one newline when the source had one and the output
 * has none, and strip trailing newlines when the source had none. Leaving an
 * already-present newline untouched avoids adding an extra blank line.
 */
function matchFinalNewline(output: string, source: string): string {
  const sourceHasFinalNewline = source.endsWith('\n')
  const outputHasFinalNewline = output.endsWith('\n')
  if (sourceHasFinalNewline === outputHasFinalNewline) return output
  return sourceHasFinalNewline
    ? `${output}\n`
    : output.replace(/\n+$/, '')
}

function compactTable(lines: string[]): string[] {
  const rows = lines.map(splitCells)
  const alignments = rows[1].map((cell) => alignmentOf(cell) ?? 'none')
  const width = Math.max(...rows.map((row) => row.length))
  const renderRow = (cells: string[]) =>
    `| ${Array.from({ length: width }, (_, index) => cells[index] ?? '').join(' | ')} |`
  const dashes: Record<Alignment, string> = {
    none: '---',
    left: ':---',
    right: '---:',
    center: ':---:',
  }
  return [
    renderRow(rows[0]),
    `|${alignments.map((alignment) => dashes[alignment]).join('|')}|`,
    ...rows.slice(2).map(renderRow),
  ]
}

/**
 * Replace each generated table with its original text when semantics match,
 * otherwise with compact GFM. Surrounding blank lines follow the original
 * (capped at one for genuinely changed tables) so Tiptap's extra blank lines
 * never reach the published Markdown.
 */
export function normalizeMarkdown(generated: string, source: string): string {
  const generatedLines = generated.split('\n')
  const sourceLines = source.split('\n')
  const generatedBlocks = findTableBlocks(generatedLines)
  if (generatedBlocks.length === 0) return matchFinalNewline(generated, source)

  const sourceBlocks = findTableBlocks(sourceLines)
  const usedSource = new Set<number>()
  const result: string[] = []
  let cursor = 0

  generatedBlocks.forEach((block, index) => {
    result.push(...generatedLines.slice(cursor, block.start))
    while (result.length && isBlank(result[result.length - 1])) result.pop()

    const sameIndex = sourceBlocks[index]?.signature === block.signature && !usedSource.has(index)
      ? index
      : -1
    const matchIndex = sameIndex >= 0
      ? sameIndex
      : sourceBlocks.findIndex((candidate, candidateIndex) =>
        !usedSource.has(candidateIndex) && candidate.signature === block.signature)
    const matched = matchIndex >= 0 ? sourceBlocks[matchIndex] : null
    if (matched) usedSource.add(matchIndex)

    const fallback = sourceBlocks[index]
      ? blankCounts(sourceLines, sourceBlocks[index].start, sourceBlocks[index].end)
      : { leading: 1, trailing: 1 }
    const sourceContext = matched
      ? blankCounts(sourceLines, matched.start, matched.end)
      : { leading: Math.min(fallback.leading, 1), trailing: Math.min(fallback.trailing, 1) }

    result.push(...Array(sourceContext.leading).fill(''))
    result.push(...(matched ? matched.lines : compactTable(block.lines)))

    cursor = block.end
    while (cursor < generatedLines.length && isBlank(generatedLines[cursor])) cursor += 1
    if (cursor < generatedLines.length || sourceContext.trailing > 0) {
      result.push(...Array(sourceContext.trailing).fill(''))
    }
  })

  result.push(...generatedLines.slice(cursor))
  return matchFinalNewline(result.join('\n'), source)
}
