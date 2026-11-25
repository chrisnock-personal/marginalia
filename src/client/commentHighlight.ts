import { Extension } from '@tiptap/core'
import type { Editor } from '@tiptap/react'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { Comment } from '../shared/types'
import { resolveAnchor } from './anchors'
import { repoPathFor } from './assetPaths'

const SET_COMMENTS = 'marginaliaSetComments'

interface CommentState {
  comments: Comment[]
  docPath: string
  decorations: DecorationSet
}

interface CommentMeta {
  comments: Comment[]
  docPath: string
}

export const commentKey = new PluginKey<CommentState>('marginaliaComments')

function decorationsFor(comments: Comment[], docPath: string, doc: Parameters<typeof resolveAnchor>[0]): DecorationSet {
  const decorations: Decoration[] = []
  // Replies share their parent's target; only root comments get a highlight.
  const roots = comments.filter((comment) => !comment.parentId)

  for (const comment of roots) {
    if (comment.anchor) {
      const range = resolveAnchor(doc, comment.anchor)
      if (range) {
        decorations.push(
          Decoration.inline(range.from, range.to, {
            class: comment.resolved ? 'comment-mark resolved' : 'comment-mark',
            'data-comment-id': comment.id,
          }),
        )
      }
      continue
    }
    if (comment.target?.type !== 'image') continue
    doc.descendants((node, pos) => {
      if (node.type.name !== 'image') return
      const src = String(node.attrs.src ?? '')
      const imagePath = repoPathFor(docPath, src) ?? src
      if (imagePath !== comment.target?.path && src !== comment.target?.path) return
      decorations.push(
        Decoration.node(pos, pos + node.nodeSize, {
          class: comment.resolved ? 'comment-mark-image resolved' : 'comment-mark-image',
          'data-comment-id': comment.id,
        }),
      )
    })
  }
  return DecorationSet.create(doc, decorations)
}

export const CommentHighlight = Extension.create({
  name: 'commentHighlight',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: commentKey,
        state: {
          init: (): CommentState => ({ comments: [], docPath: '', decorations: DecorationSet.empty }),
          apply(tr, value): CommentState {
            const meta = tr.getMeta(SET_COMMENTS) as CommentMeta | undefined
            const comments = meta?.comments ?? value.comments
            const docPath = meta?.docPath ?? value.docPath
            if (!tr.docChanged && !meta) return value
            return { comments, docPath, decorations: decorationsFor(comments, docPath, tr.doc) }
          },
        },
        props: {
          decorations: (state) => commentKey.getState(state)?.decorations ?? DecorationSet.empty,
        },
      }),
    ]
  },
})

export function setCommentHighlights(editor: Editor | null, comments: Comment[], docPath: string): void {
  if (!editor || editor.isDestroyed) return
  const meta: CommentMeta = { comments, docPath }
  editor.view.dispatch(editor.state.tr.setMeta(SET_COMMENTS, meta))
}
