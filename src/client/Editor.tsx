import { Markdown } from '@tiptap/markdown'
import { EditorContent, useEditor, useEditorState } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { useEffect } from 'react'
import type { Comment, CommentAnchor } from '../shared/types'
import { anchorFromSelection } from './anchors'
import { CommentHighlight, setCommentHighlights } from './commentHighlight'

interface Props {
  documentKey: string
  markdown: string
  comments: Comment[]
  onChange: (markdown: string) => void
  onAddComment: (anchor: CommentAnchor | null) => void
}

export default function Editor({ documentKey, markdown, comments, onChange, onAddComment }: Props) {
  const editor = useEditor({
    extensions: [StarterKit, Markdown, CommentHighlight],
    content: markdown,
    contentType: 'markdown',
    onUpdate: ({ editor: current }) => onChange(current.getMarkdown()),
  })

  // Tiptap 3 does not re-render on every transaction; subscribe to the bits of
  // editor state the toolbar depends on.
  const state = useEditorState({
    editor,
    selector: ({ editor: current }) => ({
      selectionEmpty: current.state.selection.empty,
      bold: current.isActive('bold'),
      italic: current.isActive('italic'),
      heading: current.isActive('heading', { level: 2 }),
      bullet: current.isActive('bulletList'),
      ordered: current.isActive('orderedList'),
      quote: current.isActive('blockquote'),
      codeBlock: current.isActive('codeBlock'),
    }),
  })

  // Load a new document (or a reload after a conflict). Typing is a no-op here:
  // the prop already equals what the editor produced in onUpdate.
  useEffect(() => {
    if (editor && !editor.isDestroyed && editor.getMarkdown() !== markdown) {
      editor.commands.setContent(markdown, { contentType: 'markdown', emitUpdate: false })
    }
  }, [documentKey, editor, markdown])

  useEffect(() => {
    setCommentHighlights(editor, comments)
  }, [editor, comments])

  if (!editor) return null

  const tool = (label: string, action: () => void, active = false, title?: string) => (
    <button
      type="button"
      className={active ? 'tool tool-active' : 'tool'}
      onClick={action}
      title={title ?? label}
    >
      {label}
    </button>
  )

  const addComment = () => {
    const { from, to } = editor.state.selection
    onAddComment(anchorFromSelection(editor.state.doc, from, to))
  }

  return (
    <div className="editor-shell">
      <div className="toolbar">
        {tool('B', () => editor.chain().focus().toggleBold().run(), state?.bold, 'Bold')}
        {tool('I', () => editor.chain().focus().toggleItalic().run(), state?.italic, 'Italic')}
        {tool('H2', () => editor.chain().focus().toggleHeading({ level: 2 }).run(), state?.heading, 'Heading 2')}
        {tool('• list', () => editor.chain().focus().toggleBulletList().run(), state?.bullet, 'Bullet list')}
        {tool('1. list', () => editor.chain().focus().toggleOrderedList().run(), state?.ordered, 'Ordered list')}
        {tool('quote', () => editor.chain().focus().toggleBlockquote().run(), state?.quote, 'Quote')}
        {tool('code', () => editor.chain().focus().toggleCodeBlock().run(), state?.codeBlock, 'Code block')}
        <span className="toolbar-divider" />
        {tool('↶', () => editor.chain().focus().undo().run(), false, 'Undo')}
        {tool('↷', () => editor.chain().focus().redo().run(), false, 'Redo')}
        <span className="toolbar-divider" />
        <button type="button" className="tool tool-comment" onClick={addComment} disabled={state?.selectionEmpty ?? true}>
          + Comment
        </button>
      </div>
      <EditorContent className="editor-content" editor={editor} />
    </div>
  )
}
