import { useState } from 'react'
import type { Comment, CommentAnchor } from '../shared/types'

interface Props {
  path: string | null
  comments: Comment[]
  pendingAnchor: CommentAnchor | null
  onSave: (body: string, author: string, parentId?: string) => void
  onCancel: () => void
  onToggleResolved: (id: string) => void
  onDelete: (id: string) => void
}

export default function CommentsPanel({
  path,
  comments,
  pendingAnchor,
  onSave,
  onCancel,
  onToggleResolved,
  onDelete,
}: Props) {
  const [body, setBody] = useState('')
  const [author, setAuthor] = useState(() => localStorage.getItem('marginalia.author') ?? 'Reviewer')
  const [replyTo, setReplyTo] = useState<string | null>(null)
  const [replyBody, setReplyBody] = useState('')
  const visible = comments.filter((comment) => !path || comment.path === path)
  const roots = visible.filter((comment) => !comment.parentId)
  const repliesOf = (id: string) => visible.filter((comment) => comment.parentId === id)

  const rememberAuthor = () => localStorage.setItem('marginalia.author', author)

  const save = () => {
    if (!body.trim()) return
    rememberAuthor()
    onSave(body.trim(), author.trim() || 'Reviewer')
    setBody('')
  }

  const saveReply = (parentId: string) => {
    if (!replyBody.trim()) return
    rememberAuthor()
    onSave(replyBody.trim(), author.trim() || 'Reviewer', parentId)
    setReplyBody('')
    setReplyTo(null)
  }

  return (
    <aside className="comments-panel">
      <header className="panel-header">
        <h2>Comments</h2>
        <span className="count">{visible.length}</span>
      </header>

      {pendingAnchor && (
        <div className="composer">
          <div className="composer-quote">“{pendingAnchor.quote}”</div>
          <textarea
            autoFocus
            value={body}
            placeholder="Write an inline comment…"
            onChange={(event) => setBody(event.target.value)}
          />
          <input value={author} aria-label="Author" onChange={(event) => setAuthor(event.target.value)} />
          <div className="composer-actions">
            <button type="button" className="primary" onClick={save} disabled={!body.trim()}>
              Add comment
            </button>
            <button type="button" onClick={onCancel}>Cancel</button>
          </div>
        </div>
      )}

      <div className="comment-list">
        {roots.length === 0 && !pendingAnchor && (
          <p className="empty-hint">Select text in the document and click “+ Comment”.</p>
        )}
        {roots.map((comment) => (
          <article key={comment.id} className={comment.resolved ? 'comment resolved' : 'comment'}>
            <blockquote>{comment.anchor.quote}</blockquote>
            <p className="comment-body">{comment.body}</p>
            <div className="comment-meta">
              <span>{comment.author}</span>
              <span>{new Date(comment.createdAt).toLocaleString()}</span>
            </div>
            <div className="comment-actions">
              <button type="button" onClick={() => { setReplyTo(comment.id); setReplyBody('') }}>Reply</button>
              <button type="button" onClick={() => onToggleResolved(comment.id)}>
                {comment.resolved ? 'Reopen' : 'Resolve'}
              </button>
              <button type="button" onClick={() => onDelete(comment.id)}>Delete</button>
            </div>

            {repliesOf(comment.id).length > 0 && (
              <div className="replies">
                {repliesOf(comment.id).map((reply) => (
                  <div key={reply.id} className="reply">
                    <p className="comment-body">{reply.body}</p>
                    <div className="comment-meta">
                      <span>{reply.author}</span>
                      <span>{new Date(reply.createdAt).toLocaleString()}</span>
                    </div>
                    <div className="comment-actions">
                      <button type="button" onClick={() => { setReplyTo(comment.id); setReplyBody('') }}>Reply</button>
                      <button type="button" onClick={() => onDelete(reply.id)}>Delete</button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {replyTo === comment.id && (
              <div className="reply-composer">
                <textarea
                  autoFocus
                  value={replyBody}
                  placeholder={`Reply to ${comment.author}…`}
                  onChange={(event) => setReplyBody(event.target.value)}
                />
                <div className="composer-actions">
                  <button type="button" className="primary" onClick={() => saveReply(comment.id)} disabled={!replyBody.trim()}>
                    Reply
                  </button>
                  <button type="button" onClick={() => setReplyTo(null)}>Cancel</button>
                </div>
              </div>
            )}
          </article>
        ))}
      </div>
    </aside>
  )
}
