import assert from 'node:assert/strict'
import { test } from 'node:test'
import { getSchema } from '@tiptap/core'
import { Markdown } from '@tiptap/markdown'
import { Node as PMNode } from '@tiptap/pm/model'
import StarterKit from '@tiptap/starter-kit'
import { anchorFromSelection, resolveAnchor } from './anchors'

const schema = getSchema([StarterKit, Markdown])

function document(): PMNode {
  return PMNode.fromJSON(schema, {
    type: 'doc',
    content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'Say hello there.' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'Second line.' }] },
    ],
  })
}

test('selection becomes a re-anchorable quote with context', () => {
  const doc = document()
  // ProseMirror positions are 1-based inside the paragraph.
  const anchor = anchorFromSelection(doc, 5, 10)
  assert.ok(anchor)
  assert.equal(anchor.quote, 'hello')
  assert.equal(anchor.prefix, 'Say ')
  const resolved = resolveAnchor(doc, anchor)
  assert.deepEqual(resolved, { from: 5, to: 10 })
})

test('anchors are found again after nearby edits', () => {
  const doc = document()
  const anchor = anchorFromSelection(doc, 5, 10)!
  const edited = PMNode.fromJSON(schema, {
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Please say hello there.' }] }],
  })
  assert.deepEqual(resolveAnchor(edited, anchor), { from: 12, to: 17 })
})

test('deleted quotes are reported as unresolved', () => {
  const doc = document()
  const anchor = anchorFromSelection(doc, 5, 10)!
  const edited = PMNode.fromJSON(schema, {
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Nothing to see here.' }] }],
  })
  assert.equal(resolveAnchor(edited, anchor), null)
})
