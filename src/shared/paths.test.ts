import assert from 'node:assert/strict'
import { test } from 'node:test'
import { checkRelativePath } from './paths'

test('relative paths allow nested files but reject traversal and empty segments', () => {
  assert.equal(checkRelativePath('docs/guide.md'), 'docs/guide.md')
  for (const path of ['', '/root.md', '../up.md', 'docs/../up.md', 'docs/./page.md', 'docs//page.md', 'docs/page.md/', 'docs\\page.md', 'docs/page\0.md']) {
    assert.throws(() => checkRelativePath(path), /Invalid relative path/)
  }
})
