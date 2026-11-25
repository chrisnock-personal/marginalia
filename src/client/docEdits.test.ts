import assert from 'node:assert/strict'
import { test } from 'node:test'
import { updateDocEdit } from './docEdits'

test('an edit is stored under its own path without touching other files', () => {
  const edits = updateDocEdit({ 'docs/other.md': '# Other edit\n' }, 'docs/page.md', '# Page edit\n', '# Page\n')
  assert.deepEqual(edits, {
    'docs/other.md': '# Other edit\n',
    'docs/page.md': '# Page edit\n',
  })
})

test('editing back to the base text removes the pending change', () => {
  const edits = updateDocEdit({ 'docs/page.md': '# Page edit\n' }, 'docs/page.md', '# Page\n', '# Page\n')
  assert.deepEqual(edits, {})
})

test('an unchanged value keeps the same map so React can skip a render', () => {
  const edits = { 'docs/page.md': '# Page edit\n' }
  assert.equal(updateDocEdit(edits, 'docs/page.md', '# Page edit\n', '# Page\n'), edits)
})
