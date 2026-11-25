import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildExportHtml, escapeHtml } from './export'

test('export builds a standalone print view with absolute image URLs and comments', () => {
  const html = buildExportHtml({
    title: 'docs/guide.md',
    html: '<h1>Guide</h1><img src="assets/pic.png" alt="Pic"><table><tr><td>A</td></tr></table>',
    comments: [
      {
        id: 'c_1',
        path: 'docs/guide.md',
        anchor: { quote: 'Guide', prefix: '', suffix: '', start: 0, end: 5 },
        body: 'Check this <heading>',
        author: 'Chris',
        createdAt: '2026-11-25T10:00:00.000Z',
        resolved: false,
      },
      {
        id: 'c_2',
        path: 'docs/guide.md',
        target: { type: 'image', path: 'docs/assets/pic.png' },
        body: 'New image?',
        author: 'Chris',
        createdAt: '2026-11-25T10:01:00.000Z',
        resolved: true,
      },
    ],
    includeComments: true,
  })
  assert.match(html, /<title>docs\/guide\.md<\/title>/)
  assert.match(html, /@page \{ size: A4/)
  assert.match(html, /src="http:\/\/marginalia\.local\/assets\/pic\.png"/)
  assert.match(html, /Check this &lt;heading&gt;/)
  assert.match(html, /Image: docs\/assets\/pic\.png/)
  assert.match(html, /class="comment resolved"/)
})

test('export can omit the comment appendix', () => {
  const html = buildExportHtml({ title: 'Guide', html: '<p>Text</p>', comments: [], includeComments: false })
  assert.doesNotMatch(html, /<section class="comments">/)
  assert.equal(escapeHtml(`<&"'`), '&lt;&amp;&quot;&#39;')
})
