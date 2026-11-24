import { Markdown } from '@tiptap/markdown'
import { EditorContent, useEditor } from '@tiptap/react'
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

  // Reload the editor only when a different document is opened, not on every keystroke.
  useEffect(() => {
    if (editor && !editor.isDestroyed) {
      editor.commands.setContent(markdown, { contentType: 'markdown', emitUpdate: false })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentKey, editor])

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
        {tool('B', () => editor.chain().focus().toggleBold().run(), editor.isActive('bold'), 'Bold')}
        {tool('I', () => editor.chain().focus().toggleItalic().run(), editor.isActive('italic'), 'Italic')}
        {tool('H2', () => editor.chain().focus().toggleHeading({ level: 2 }).run(), editor.isActive('heading', { level: 2 }), 'Heading 2')}
        {tool('• list', () => editor.chain().focus().toggleBulletList().run(), editor.isActive('bulletList'), 'Bullet list')}
        {tool('1. list', () => editor.chain().focus().toggleOrderedList().run(), editor.isActive('orderedList'), 'Ordered list')}
        {tool('quote', () => editor.chain().focus().toggleBlockquote().run(), editor.isActive('blockquote'), 'Quote')}
        {tool('code', () => editor.chain().focus().toggleCodeBlock().run(), editor.isActive('codeBlock'), 'Code block')}
        <span className="toolbar-divider" />
        {tool('↶', () => editor.chain().focus().undo().run(), false, 'Undo')}
        {tool('↷', () => editor.chain().focus().redo().run(), false, 'Redo')}
        <span className="toolbar-divider" />
        <button type="button" className="tool tool-comment" onClick={addComment} disabled={editor.state.selection.empty}>
          + Comment
        </button>
      </div>
      <EditorContent className="editor-content" editor={editor} />
    </div>
  )
}
