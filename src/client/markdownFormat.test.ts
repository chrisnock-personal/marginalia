import assert from 'node:assert/strict'
import { test } from 'node:test'
import { normalizeMarkdown } from './markdownFormat'

test('an unchanged padded table is restored to the original compact text', () => {
  const source = `# Runbook

Before.

| Severity | Who to call | Within |
|---|---|---|
| SEV1: orders failing | Platform lead, then the database owner | 15 minutes |

After.
`
  const generated = `# Runbook

Before.


| Severity                  | Who to call                            | Within     |
| ------------------------- | -------------------------------------- | ---------- |
| SEV1: orders failing      | Platform lead, then the database owner | 15 minutes |


After.
`

  assert.equal(normalizeMarkdown(generated, source), source)
})

test('a genuinely changed table is emitted as compact GFM without extra blank lines', () => {
  const source = [
    '| A | B |',
    '|---|---|',
    '| one | two |',
    '',
  ].join('\n')
  const generated = [
    '',
    '| AAAA                 | Bee   |',
    '| -------------------- | ----- |',
    '| one                  | two   |',
    '',
    '',
  ].join('\n')

  assert.equal(normalizeMarkdown(generated, source), [
    '| AAAA | Bee |',
    '|---|---|',
    '| one | two |',
    '',
  ].join('\n'))
})

test('Markdown without tables is passed through untouched', () => {
  const generated = '# Notes\n\n- one\n- two\n\nText with | a pipe.\n'
  assert.equal(normalizeMarkdown(generated, '# Different source\n'), generated)
})

test('the original final-newline convention is preserved', () => {
  const source = [
    '| A | B |',
    '|---|---|',
    '| one | two |',
    '',
    'After the table.',
    '',
  ].join('\n')
  const generated = [
    '',
    '| A    | B    |',
    '| ---- | ---- |',
    '| one  | two  |',
    '',
    '',
    'After the table.',
  ].join('\n')

  const restored = normalizeMarkdown(generated, source)
  assert.equal(restored, source)
  assert.ok(restored.endsWith('\n'))
  assert.ok(!restored.endsWith('\n\n'))

  const sourceWithoutFinalNewline = source.replace(/\n$/, '')
  assert.equal(
    normalizeMarkdown(`${generated}\n`, sourceWithoutFinalNewline),
    sourceWithoutFinalNewline,
  )

  // The fast path for documents without tables must follow the same rule.
  assert.equal(normalizeMarkdown('No table here', 'Original\n'), 'No table here\n')
})

test('escaped pipes and inline code in cells survive restoration and compaction', () => {
  const source = [
    '# Cells',
    '',
    '| Expr | Note |',
    '|---|---|',
    '| `a \\| b` | escaped \\| pipe |',
    '',
    'Tail.',
    '',
  ].join('\n')
  const generated = [
    '# Cells',
    '',
    '',
    '| Expr                   | Note               |',
    '| ---------------------- | ------------------ |',
    '| `a \\| b`               | escaped \\| pipe |',
    '',
    '',
    'Tail.',
    '',
  ].join('\n')

  assert.equal(normalizeMarkdown(generated, source), source)

  const changed = [
    '# Cells',
    '',
    '',
    '| Expr                   | Note |',
    '| ---------------------- | ---- |',
    '| `a \\| b`               | new  |',
    '',
    '',
    'Tail.',
    '',
  ].join('\n')
  assert.equal(normalizeMarkdown(changed, source), [
    '# Cells',
    '',
    '| Expr | Note |',
    '|---|---|',
    '| `a \\| b` | new |',
    '',
    'Tail.',
    '',
  ].join('\n'))
})

test('a new file (empty source) keeps a final newline after editing', () => {
  assert.equal(normalizeMarkdown('# Release notes\n\nFirst draft.', ''), '# Release notes\n\nFirst draft.\n')
  assert.equal(normalizeMarkdown('# Release notes\n\nFirst draft.\n', ''), '# Release notes\n\nFirst draft.\n')
})
