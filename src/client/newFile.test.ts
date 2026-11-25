import assert from 'node:assert/strict'
import { test } from 'node:test'
import { newMarkdownFile } from './newFile'

test('a name without an extension gets .md and a title from the file name', () => {
  assert.deepEqual(newMarkdownFile('onboarding', 'docs'), {
    path: 'docs/onboarding.md',
    content: '# Onboarding\n\n',
    title: 'Onboarding',
  })
})

test('markdown extensions, folders and punctuation are accepted', () => {
  assert.deepEqual(newMarkdownFile('getting-started.markdown', './guides/'), {
    path: 'guides/getting-started.markdown',
    content: '# Getting started\n\n',
    title: 'Getting started',
  })
})

test('other extensions and names with separators are rejected', () => {
  assert.throws(() => newMarkdownFile('notes.txt', ''), /Only \.md and \.markdown/)
  assert.throws(() => newMarkdownFile('docs/notes.md', ''), /folder field/)
  assert.throws(() => newMarkdownFile('', ''), /Enter a file name/)
})

test('relative path checks apply to the folder as well as the name', () => {
  assert.throws(() => newMarkdownFile('notes.md', '../private'), /Invalid relative path/)
  assert.throws(() => newMarkdownFile('notes.md', '/absolute'), /Invalid relative path/)
  assert.throws(() => newMarkdownFile('notes.md', 'docs//drafts'), /Invalid relative path/)
  assert.throws(() => newMarkdownFile('notes.md', 'docs\\drafts'), /Invalid relative path/)
})
