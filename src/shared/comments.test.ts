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

test('image-target comments round-trip without a text anchor', () => {
  const { anchor: _anchor, ...withoutAnchor } = sample.comments[0]
  const imageComment = {
    ...withoutAnchor,
    target: { type: 'image' as const, path: 'docs/assets/pic.png' },
  }
  assert.deepEqual(parseComments(serializeComments({ version: 1, comments: [imageComment] })), {
    version: 1,
    comments: [imageComment],
  })
  assert.throws(
    () => parseComments(JSON.stringify({ version: 1, comments: [{ ...imageComment, target: { type: 'image' } }] })),
    /target/,
  )
  assert.throws(
    () => parseComments(JSON.stringify({ version: 1, comments: [{ ...sample.comments[0], target: {} }] })),
    /invalid fields/,
  )
})
