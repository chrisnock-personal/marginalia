import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  buildExportHtml,
  bytesToBase64,
  escapeHtml,
  imageDataUrl,
  inlineImageSources,
  resolveExportImageSource,
  type ResolveImageSourceOptions,
} from './export'

const stagedBase64 = 'c3RhZ2Vk'
const repoBase64 = 'cmVwbw=='

function imageOptions(overrides: Partial<ResolveImageSourceOptions> = {}): ResolveImageSourceOptions {
  return {
    docPath: 'docs/guide.md',
    provider: 'local',
    repoId: 'ops-handbook',
    baseRef: 'main',
    assets: [],
    previewToSrc: () => undefined,
    assetBase64: async () => { throw new Error('unexpected base asset read') },
    ...overrides,
  }
}

test('export builds a standalone print view with inlined images and comments', () => {
  const dataUrl = 'data:image/png;base64,iVBORw0KGgo='
  const html = buildExportHtml({
    title: 'docs/guide.md',
    html: `<h1>Guide</h1><img src="${dataUrl}" alt="Pic"><table><tr><td>A</td></tr></table>`,
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
  assert.ok(html.includes(`src="${dataUrl}"`))
  assert.doesNotMatch(html, /marginalia\.local|\/api\/repos/)
  assert.match(html, /Check this &lt;heading&gt;/)
  assert.match(html, /Image: docs\/assets\/pic\.png/)
  assert.match(html, /class="comment resolved"/)
})

test('export can omit the comment appendix', () => {
  const html = buildExportHtml({ title: 'Guide', html: '<p>Text</p>', comments: [], includeComments: false })
  assert.doesNotMatch(html, /<section class="comments">/)
  assert.equal(escapeHtml(`<&"'`), '&lt;&amp;&quot;&#39;')
})

test('inlineImageSources replaces resolvable sources and leaves the rest alone', async () => {
  const html = [
    '<img src="data:image/gif;base64,R0lGODlh">',
    '<img src="assets/pic.jpg">',
    '<img src="https://example.com/missing.png">',
  ].join('')
  const result = await inlineImageSources(html, async (src) => {
    if (src.startsWith('data:')) return src
    if (src === 'assets/pic.jpg') return imageDataUrl('assets/pic.jpg', repoBase64)
    return null
  })
  assert.ok(result.includes('src="data:image/gif;base64,R0lGODlh"'))
  assert.ok(result.includes(`src="data:image/jpeg;base64,${repoBase64}"`))
  assert.ok(result.includes('src="https://example.com/missing.png"'))
})

test('staged blob images use staged bytes rather than the base ref', async () => {
  const options = imageOptions({
    assets: [{
      path: 'docs/assets/incidents/2026-10-14-latency.png',
      content: stagedBase64,
      encoding: 'base64',
    }],
    previewToSrc: (url) => url === 'blob:preview-1' ? 'assets/incidents/2026-10-14-latency.png' : undefined,
  })
  const src = await resolveExportImageSource('blob:preview-1', options)
  assert.equal(src, `data:image/png;base64,${stagedBase64}`)
  const html = await inlineImageSources('<img src="blob:preview-1">', (value) =>
    resolveExportImageSource(value, options))
  assert.ok(html.includes(`src="data:image/png;base64,${stagedBase64}"`))
})

test('repo-relative and API asset URLs resolve to base64 bytes', async () => {
  const path = 'docs/assets/photo.webp'
  assert.equal(
    await resolveExportImageSource('assets/photo.webp', imageOptions({
      assetBase64: async (provider, repo, assetPath, ref) => {
        assert.equal(provider, 'local')
        assert.equal(repo, 'ops-handbook')
        assert.equal(assetPath, path)
        assert.equal(ref, 'main')
        return repoBase64
      },
    })),
    `data:image/webp;base64,${repoBase64}`,
  )

  const apiSrc = '/api/repos/local/ops-handbook/asset?path=docs%2Fassets%2Ficon.svg&amp;ref=main'
  assert.equal(
    await resolveExportImageSource(apiSrc, imageOptions({
      assetBase64: async (_provider, _repo, assetPath, ref) => {
        assert.equal(assetPath, 'docs/assets/icon.svg')
        assert.equal(ref, 'main')
        return repoBase64
      },
    })),
    `data:image/svg+xml;base64,${repoBase64}`,
  )
})

test('external images are inlined when fetchable and kept when not', async () => {
  const bytes = new Uint8Array([0, 1, 2, 3])
  assert.equal(
    await resolveExportImageSource('https://example.com/pic.gif', imageOptions({
      fetchBytes: async () => bytes.buffer,
    })),
    `data:image/gif;base64,${bytesToBase64(bytes)}`,
  )

  const options = imageOptions({
    fetchBytes: async () => { throw new Error('offline') },
  })
  assert.equal(await resolveExportImageSource('https://example.com/missing.png', options), null)
  const html = '<img src="https://example.com/missing.png">'
  assert.equal(
    await inlineImageSources(html, (src) => resolveExportImageSource(src, options)),
    html,
  )
})

test('imageDataUrl falls back to PNG for unknown extensions', () => {
  assert.equal(imageDataUrl('assets/photo', repoBase64), `data:image/png;base64,${repoBase64}`)
})
