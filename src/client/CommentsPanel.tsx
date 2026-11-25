import { useState } from 'react'
import type { Comment, CommentAnchor, ImageTarget } from '../shared/types'

interface Props {
  path: string | null
  comments: Comment[]
  pendingAnchor: CommentAnchor | null
  pendingTarget: ImageTarget | null
  onSave: (body: string, author: string, parentId?: string, target?: ImageTarget) => void
  onCancel: () => void
  onToggleResolved: (id: string) => void
  onDelete: (id: string) => void
}

/** Short, readable timestamp: "20 Nov, 09:14", with the year only when it differs. */
function formatWhen(iso: string): string {
  const date = new Date(iso)
  const sameYear = date.getFullYear() === new Date().getFullYear()
  return date.toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' }),
    hour: '2-digit',
    minute: '2-digit',
  })
}

export default function CommentsPanel({
  path,
  comments,
  pendingAnchor,
  pendingTarget,
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
    onSave(body.trim(), author.trim() || 'Reviewer', undefined, pendingTarget ?? undefined)
    setBody('')
  }

  const saveReply = (parentId: string) => {
    if (!replyBody.trim()) return
    rememberAuthor()
    onSave(replyBody.trim(), author.trim() || 'Reviewer', parentId)
    setReplyBody('')
    setReplyTo(null)
  }

  const targetLabel = (comment: Comment) =>
    comment.target?.type === 'image' ? `Image: ${comment.target.path}` : `“${comment.anchor?.quote ?? ''}”`

  return (
    <aside id="comments-panel" className="comments-panel" aria-label="Comments">

      {(pendingAnchor || pendingTarget) && (
        <div className="composer">
          <div className="composer-quote">
            {pendingTarget ? `Image: ${pendingTarget.path}` : `“${pendingAnchor?.quote ?? ''}”`}
          </div>
          <textarea
            autoFocus
            value={body}
            placeholder="Write an inline comment…"
            onChange={(event) => setBody(event.target.value)}
          />
          <label className="author-field">
            <span>Your name</span>
            <input value={author} onChange={(event) => setAuthor(event.target.value)} />
          </label>
          <div className="composer-actions">
            <button type="button" className="primary" onClick={save} disabled={!body.trim()}>
              Add comment
            </button>
            <button type="button" onClick={onCancel}>Cancel</button>
          </div>
        </div>
      )}

      <div className="comment-list">
        {roots.length === 0 && !pendingAnchor && !pendingTarget && (
          <p className="empty-hint">No comments on this page yet. Select text or click an image, then choose Comment.</p>
        )}
        {roots.map((comment) => (
          <article key={comment.id} className={comment.resolved ? 'comment resolved' : 'comment'}>
            <blockquote className={comment.target ? 'comment-image-target' : undefined}>
              {targetLabel(comment)}
            </blockquote>
            <p className="comment-body">{comment.body}</p>
            <div className="comment-meta">
              <span className="author">{comment.author}</span>
              <time dateTime={comment.createdAt}>{formatWhen(comment.createdAt)}</time>
              {comment.resolved && <span className="resolved-tag">Resolved</span>}
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
                      <span className="author">{reply.author}</span>
                      <time dateTime={reply.createdAt}>{formatWhen(reply.createdAt)}</time>
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
