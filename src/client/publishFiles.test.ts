import assert from 'node:assert/strict'
import { test } from 'node:test'
import { emptyComments, serializeComments } from '../shared/comments'
import type { CommentsFile } from '../shared/types'
import { buildPublishFiles } from './publishFiles'

const comments: CommentsFile = {
  version: 1,
  comments: [{
    id: 'c_1',
    path: 'docs/page.md',
    anchor: { quote: 'Page', prefix: '', suffix: '', start: 0, end: 4 },
    body: 'Check this',
    author: 'Chris',
    createdAt: '2026-11-25T10:00:00.000Z',
    resolved: false,
  }],
}

test('publish files include every edited page, rewrites, staged/deleted/moved assets and comments', () => {
  const rows = buildPublishFiles({
    docEdits: {
      'docs/page.md': '# New page\n',
      'docs/other.md': '# Rewritten links\n',
    },
    assets: [
      { path: 'docs/assets/pasted.png', content: 'cGFzdGVk', encoding: 'base64' },
      { path: 'docs/assets/gone.png', content: '', delete: true },
      { path: 'docs/assets/new.png', content: 'bW92ZWQ=', encoding: 'base64' },
      { path: 'docs/assets/old.png', content: '', delete: true },
    ],
    movedFrom: { 'docs/assets/new.png': 'docs/assets/old.png' },
    comments,
  })

  assert.deepEqual(rows.map((row) => row.change), [
    { path: 'docs/page.md', content: '# New page\n' },
    { path: 'docs/other.md', content: '# Rewritten links\n' },
    { path: 'docs/assets/pasted.png', content: 'cGFzdGVk', encoding: 'base64' },
    { path: 'docs/assets/gone.png', content: '', delete: true },
    { path: 'docs/assets/new.png', content: 'bW92ZWQ=', encoding: 'base64' },
    { path: 'docs/assets/old.png', content: '', delete: true },
    { path: 'comments.json', content: serializeComments(comments) },
  ])
  assert.deepEqual(rows.map((row) => [row.status, row.pairPath]), [
    ['edited', undefined],
    ['edited', undefined],
    ['added', undefined],
    ['deleted', undefined],
    ['moved', 'docs/assets/old.png'],
    ['deleted', 'docs/assets/new.png'],
    ['comments', undefined],
  ])
  assert.equal(rows[6].commentCount, 1)
})

test('no Markdown edits still publishes staged assets and comments.json', () => {
  const rows = buildPublishFiles({
    docEdits: {},
    assets: [{ path: 'docs/assets/pasted.png', content: 'YQ==', encoding: 'base64' }],
    comments: emptyComments(),
  })

  assert.deepEqual(rows.map((row) => row.change), [
    { path: 'docs/assets/pasted.png', content: 'YQ==', encoding: 'base64' },
    { path: 'comments.json', content: serializeComments(emptyComments()) },
  ])
  assert.deepEqual(rows.map((row) => row.status), ['added', 'comments'])
})

test('an add and delete are not a move unless recorded as one', () => {
  const rows = buildPublishFiles({
    docEdits: {},
    assets: [
      { path: 'docs/assets/pasted.png', content: 'YQ==', encoding: 'base64' },
      { path: 'docs/assets/old.png', content: '', delete: true },
    ],
    comments: emptyComments(),
  })

  assert.deepEqual(rows.slice(0, 2).map((row) => row.status), ['added', 'deleted'])
  assert.equal(rows[0].pairPath, undefined)
  assert.equal(rows[1].pairPath, undefined)
})

test('a stale move record without both staged entries is ignored', () => {
  const rows = buildPublishFiles({
    docEdits: {},
    assets: [{ path: 'docs/assets/old.png', content: '', delete: true }],
    movedFrom: { 'docs/assets/new.png': 'docs/assets/old.png' },
    comments: emptyComments(),
  })

  assert.equal(rows[0].status, 'deleted')
  assert.equal(rows[0].pairPath, undefined)
})
