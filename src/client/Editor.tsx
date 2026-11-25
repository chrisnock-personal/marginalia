import { Markdown } from '@tiptap/markdown'
import { EditorContent, useEditor, useEditorState } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { TableKit } from '@tiptap/extension-table'
import { useEffect, useRef, type ChangeEvent, type ClipboardEvent, type DragEvent } from 'react'
import type { Editor as TiptapEditor } from '@tiptap/react'
import type { Comment, CommentAnchor, ImageTarget } from '../shared/types'
import { anchorFromSelection } from './anchors'
import { repoPathFor } from './assetPaths'
import { CommentHighlight, setCommentHighlights } from './commentHighlight'
import { normalizeMarkdown } from './markdownFormat'
import RepoImage, { clearImagePreviews, setImagePreview } from './repoImage'

interface Props {
  documentKey: string
  docPath: string
  markdown: string
  /** Original Markdown from the repo, used to preserve table formatting. */
  sourceMarkdown: string
  comments: Comment[]
  /** Resolve repo-relative image paths for display. */
  resolveSrc: (src: string) => string
  /** Called when an image is pasted/dropped/selected; App stages the bytes for the PR. */
  onAsset: (file: File, src: string) => void
  onChange: (markdown: string) => void
  /** Exactly one of anchor/target is supplied. */
  onAddComment: (anchor: CommentAnchor | null, target?: ImageTarget) => void
  onEditorReady?: (editor: TiptapEditor | null) => void
}

function safeFilename(name: string): string {
  const cleaned = name.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '')
  return cleaned || 'image.png'
}

export default function Editor({
  documentKey,
  docPath,
  markdown,
  sourceMarkdown,
  comments,
  resolveSrc,
  onAsset,
  onChange,
  onAddComment,
  onEditorReady,
}: Props) {
  // Callbacks change on every render; the editor reads the latest via a ref so
  // it need not be recreated on each keystroke.
  const callbacks = useRef({ resolveSrc, onAsset, onChange, onAddComment, onEditorReady })
  callbacks.current = { resolveSrc, onAsset, onChange, onAddComment, onEditorReady }
  // The editor is created once per document; read the base text from a ref so
  // publishing (which changes `original`) does not recreate it.
  const sourceRef = useRef(sourceMarkdown)
  sourceRef.current = sourceMarkdown
  const fileInput = useRef<HTMLInputElement>(null)

  const editor = useEditor(
    {
      extensions: [
        StarterKit,
        Markdown,
        TableKit,
        RepoImage.configure({ resolveSrc: (src) => callbacks.current.resolveSrc(src) }),
        CommentHighlight,
      ],
      content: markdown,
      contentType: 'markdown',
      onUpdate: ({ editor: current }) =>
        callbacks.current.onChange(normalizeMarkdown(current.getMarkdown(), sourceRef.current)),
    },
    // Recreate when a different document is opened so Markdown parsing and the
    // asset resolver always match the current repo.
    [documentKey],
  )

  // Tiptap 3 does not re-render on every transaction; subscribe to the bits of
  // editor state the toolbar depends on.
  const state = useEditorState({
    editor,
    selector: ({ editor: current }) => {
      const selected = current.state.doc.nodeAt(current.state.selection.from)
      return {
        selectionEmpty: current.state.selection.empty,
        selectedImageSrc: selected?.type.name === 'image' ? String(selected.attrs.src ?? '') : null,
        bold: current.isActive('bold'),
        italic: current.isActive('italic'),
        heading: current.isActive('heading', { level: 2 }),
        bullet: current.isActive('bulletList'),
        ordered: current.isActive('orderedList'),
        quote: current.isActive('blockquote'),
        codeBlock: current.isActive('codeBlock'),
        table: current.isActive('table'),
      }
    },
  })

  useEffect(() => () => clearImagePreviews(), [documentKey])

  useEffect(() => {
    callbacks.current.onEditorReady?.(editor)
    return () => callbacks.current.onEditorReady?.(null)
  }, [editor])

  // Load a new document (or a reload after a conflict). Typing is a no-op here:
  // the prop already equals what the editor produced in onUpdate.
  useEffect(() => {
    if (editor && !editor.isDestroyed &&
        normalizeMarkdown(editor.getMarkdown(), sourceMarkdown) !== markdown) {
      editor.commands.setContent(markdown, { contentType: 'markdown', emitUpdate: false })
    }
  }, [documentKey, editor, markdown, sourceMarkdown])

  useEffect(() => {
    setCommentHighlights(editor, comments, docPath)
  }, [editor, comments, docPath])

  if (!editor) return null

  const tool = (label: string, action: () => void, active = false, title?: string, extra = '') => (
    <button
      type="button"
      className={['tool', active && 'tool-active', extra].filter(Boolean).join(' ')}
      onClick={action}
      title={title ?? label}
      aria-label={title ?? label}
      aria-pressed={active || undefined}
    >
      {label}
    </button>
  )

  const addComment = () => {
    if (state?.selectedImageSrc) {
      const src = state.selectedImageSrc
      onAddComment(null, {
        type: 'image',
        path: repoPathFor(docPath, src) ?? src,
      })
      return
    }
    const { from, to } = editor.state.selection
    onAddComment(anchorFromSelection(editor.state.doc, from, to))
  }

  const insertImageUrl = () => {
    const url = window.prompt('Image URL (https://… or a path in this repo)')
    if (url?.trim()) editor.chain().focus().setImage({ src: url.trim() }).run()
  }

  const stageImages = (files: FileList | File[]) => {
    const images = Array.from(files).filter((file) => file.type.startsWith('image/'))
    if (!images.length) return false
    for (const file of images) {
      const name = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}-${safeFilename(file.name)}`
      // Assets live in an `assets/` folder next to the Markdown file, so the
      // Markdown link stays short and relative (`assets/name.png`).
      const src = `assets/${name}`
      setImagePreview(src, URL.createObjectURL(file))
      callbacks.current.onAsset(file, src)
      // Insert after the selection rather than replacing it (the cursor may be
      // sitting on an existing image).
      const position = editor.state.selection.to
      editor.chain().focus().insertContentAt(position, {
        type: 'image',
        attrs: { src, alt: file.name },
      }).run()
    }
    return true
  }

  const handlePaste = (event: ClipboardEvent<HTMLDivElement>) => {
    const files = event.clipboardData?.files
    if (files?.length && Array.from(files).some((file) => file.type.startsWith('image/'))) {
      event.preventDefault()
      stageImages(files)
    }
  }

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    const files = event.dataTransfer?.files
    if (files?.length && Array.from(files).some((file) => file.type.startsWith('image/'))) {
      event.preventDefault()
      stageImages(files)
    }
  }

  const handleFileInput = (event: ChangeEvent<HTMLInputElement>) => {
    if (event.target.files) stageImages(event.target.files)
    event.target.value = ''
  }

  return (
    <div className="editor-shell">
      <div className="toolbar">
        {tool('B', () => editor.chain().focus().toggleBold().run(), state?.bold, 'Bold', 'tool-bold')}
        {tool('I', () => editor.chain().focus().toggleItalic().run(), state?.italic, 'Italic', 'tool-italic')}
        {tool('Heading', () => editor.chain().focus().toggleHeading({ level: 2 }).run(), state?.heading, 'Heading 2')}
        {tool('• List', () => editor.chain().focus().toggleBulletList().run(), state?.bullet, 'Bullet list')}
        {tool('1. List', () => editor.chain().focus().toggleOrderedList().run(), state?.ordered, 'Ordered list')}
        {tool('Quote', () => editor.chain().focus().toggleBlockquote().run(), state?.quote, 'Quote')}
        {tool('Code', () => editor.chain().focus().toggleCodeBlock().run(), state?.codeBlock, 'Code block')}
        <span className="toolbar-divider" />
        {tool('Table', () => editor.chain().focus().insertTable({ rows: 3, cols: 3 }).run(), state?.table, 'Insert table')}
        {tool('Image link', insertImageUrl, false, 'Insert image by URL')}
        {tool('Upload', () => fileInput.current?.click(), false, 'Upload images from your computer')}
        <input
          ref={fileInput}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={handleFileInput}
        />
        {state?.table && (
          <>
            <span className="toolbar-divider" />
            {tool('+ row', () => editor.chain().focus().addRowAfter().run(), false, 'Add row')}
            {tool('+ col', () => editor.chain().focus().addColumnAfter().run(), false, 'Add column')}
            {tool('− row', () => editor.chain().focus().deleteRow().run(), false, 'Delete row')}
            {tool('− col', () => editor.chain().focus().deleteColumn().run(), false, 'Delete column')}
          </>
        )}
        <span className="toolbar-divider" />
        {tool('↶', () => editor.chain().focus().undo().run(), false, 'Undo')}
        {tool('↷', () => editor.chain().focus().redo().run(), false, 'Redo')}
        <span className="toolbar-spacer" />
        <button
          type="button"
          className="tool tool-comment"
          onClick={addComment}
          disabled={state ? state.selectionEmpty && !state.selectedImageSrc : true}
          title={state?.selectedImageSrc ? 'Comment on this image' : 'Comment on selected text'}
        >
          Comment
        </button>
      </div>
      <div className="editor-dropzone" onPaste={handlePaste} onDrop={handleDrop} onDragOver={(event) => event.preventDefault()}>
        <EditorContent className="editor-content" editor={editor} />
      </div>
    </div>
  )
}
