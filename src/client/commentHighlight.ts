import { Extension } from '@tiptap/core'
import type { Editor } from '@tiptap/react'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { Comment } from '../shared/types'
import { resolveAnchor } from './anchors'

const SET_COMMENTS = 'marginaliaSetComments'

export const commentKey = new PluginKey<{ comments: Comment[]; decorations: DecorationSet }>(
  'marginaliaComments',
)

export const CommentHighlight = Extension.create({
  name: 'commentHighlight',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: commentKey,
        state: {
          init: (): { comments: Comment[]; decorations: DecorationSet } => ({
            comments: [],
            decorations: DecorationSet.empty,
          }),
          apply(tr, value) {
            const changed = tr.getMeta(SET_COMMENTS) as Comment[] | undefined
            const comments = changed ?? value.comments
            if (!tr.docChanged && !changed) return value
            // Replies share their parent's anchor; only root comments get a highlight.
            const marks = comments.filter((comment) => !comment.parentId).flatMap((comment) => {
              const range = resolveAnchor(tr.doc, comment.anchor)
              if (!range) return []
              return [
                Decoration.inline(range.from, range.to, {
                  class: comment.resolved ? 'comment-mark resolved' : 'comment-mark',
                  'data-comment-id': comment.id,
                }),
              ]
            })
            return { comments, decorations: DecorationSet.create(tr.doc, marks) }
          },
        },
        props: {
          decorations: (state) => commentKey.getState(state)?.decorations ?? DecorationSet.empty,
        },
      }),
    ]
  },
})

export function setCommentHighlights(editor: Editor | null, comments: Comment[]): void {
  if (!editor || editor.isDestroyed) return
  editor.view.dispatch(editor.state.tr.setMeta(SET_COMMENTS, comments))
}
