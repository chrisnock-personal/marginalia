import assert from 'node:assert/strict'
import { test } from 'node:test'
import { emptyComments, newCommentId, parseComments, serializeComments } from './comments'

const sample = {
  version: 1 as const,
  comments: [
    {
      id: newCommentId(),
      path: 'docs/guide.md',
      anchor: { quote: 'hello', prefix: 'say ', suffix: ' there', start: 0, end: 5 },
      body: 'Clarify this',
      author: 'Chris',
      createdAt: '2026-11-24T10:00:00.000Z',
      resolved: false,
    },
  ],
}

test('comments.json round-trips', () => {
  assert.deepEqual(parseComments(serializeComments(sample)), sample)
  assert.deepEqual(parseComments(serializeComments(emptyComments())), emptyComments())
})

test('replies keep their parentId through a round trip', () => {
  const threaded = { ...sample, comments: [...sample.comments, { ...sample.comments[0], id: 'reply', parentId: sample.comments[0].id }] }
  assert.deepEqual(parseComments(serializeComments(threaded)), threaded)
  const broken = serializeComments(threaded).replace('"parentId": "c_', '"parentId": 1, "x": "c_')
  assert.throws(() => parseComments(broken), /parentId/)
})

test('comments.json requires version 1 and a comments array', () => {
  assert.throws(() => parseComments('{"version":2,"comments":[]}'), /version/)
  assert.throws(() => parseComments('not json'), /valid JSON/)
  assert.throws(() => parseComments('{"version":1,"comments":[{}]}'), /comment #1/)
})
