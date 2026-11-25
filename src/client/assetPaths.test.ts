import assert from 'node:assert/strict'
import { test } from 'node:test'
import { relativeSrcFor, repoPathFor, rewriteReferences } from './assetPaths'

test('asset paths convert between repo paths and Markdown src values', () => {
  assert.equal(relativeSrcFor('docs/guide.md', 'docs/assets/pic.png'), 'assets/pic.png')
  assert.equal(relativeSrcFor('README.md', 'docs/assets/pic.png'), 'docs/assets/pic.png')
  assert.equal(repoPathFor('docs/guide.md', 'assets/pic.png'), 'docs/assets/pic.png')
  assert.equal(repoPathFor('docs/guide.md', '../shared/pic.png'), 'shared/pic.png')
  assert.equal(repoPathFor('docs/guide.md', 'https://example.com/pic.png'), null)
})

test('renaming an asset rewrites all Markdown reference styles', () => {
  const markdown = `# Guide

![Demo](assets/old.png)
![Titled](<assets/old.png> 'Demo')
[link](assets/old.png)
[ref]: assets/old.png
<img src="assets/old.png" alt="Demo">
![External](https://example.com/old.png)
`
  const rewritten = rewriteReferences(markdown, 'docs/guide.md', 'docs/assets/old.png', 'docs/images/new.png')
  assert.doesNotMatch(rewritten, /(?:^|[^/])assets\/old\.png|\/docs\/assets\/old\.png/)
  assert.match(rewritten, /!\[Demo\]\(images\/new\.png\)/)
  assert.match(rewritten, /!\[Titled\]\(<images\/new\.png> 'Demo'\)/)
  assert.match(rewritten, /\[link\]\(images\/new\.png\)/)
  assert.match(rewritten, /\[ref\]: images\/new\.png/)
  assert.match(rewritten, /<img src="images\/new\.png" alt="Demo">/)
  assert.match(rewritten, /!\[External\]\(https:\/\/example\.com\/old\.png\)/)
})

test('deleting an asset removes embeds and unlinks references', () => {
  const markdown = `Before ![Demo](assets/old.png) after.

[label](assets/old.png)

<img src="/docs/assets/old.png" alt="x">

[ref]: assets/old.png
`
  const rewritten = rewriteReferences(markdown, 'docs/guide.md', 'docs/assets/old.png', null)
  assert.doesNotMatch(rewritten, /old\.png/)
  assert.match(rewritten, /Before\s+after\./)
  assert.match(rewritten, /\nlabel\n/)
  assert.doesNotMatch(rewritten, /<img/)
})
