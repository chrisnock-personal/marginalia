import { useState, type FormEvent } from 'react'
import type { PublishFileRow } from './publishFiles'

interface Props {
  branch: string
  path: string
  files: PublishFileRow[]
  busy: boolean
  error: string | null
  conflict: boolean
  onClose: () => void
  onReload: () => void
  onPublish: (values: { branch: string; commitMessage: string; title: string; body: string }) => void
}

function describeFile(file: PublishFileRow): string {
  switch (file.status) {
    case 'edited': return 'edited'
    case 'added': return 'added'
    case 'moved': return `moved from ${file.pairPath}`
    case 'deleted': return file.pairPath ? `deleted (moved to ${file.pairPath})` : 'deleted'
    case 'comments': {
      const count = file.commentCount ?? 0
      return `${count} comment${count === 1 ? '' : 's'}`
    }
  }
}

export default function PublishDialog({
  branch: initialBranch,
  path,
  files,
  busy,
  error,
  conflict,
  onClose,
  onReload,
  onPublish,
}: Props) {
  const [branch, setBranch] = useState(initialBranch)
  const [commitMessage, setCommitMessage] = useState(`Edit ${path.split('/').pop()}`)
  const [title, setTitle] = useState(`Docs: update ${path.split('/').pop()}`)
  const [body, setBody] = useState(`Edits to \`${path}\` with inline comments in comments.json.`)

  const submit = (event: FormEvent) => {
    event.preventDefault()
    onPublish({ branch, commitMessage, title, body })
  }

  return (
    <div
      className="overlay"
      role="presentation"
      onMouseDown={busy ? undefined : onClose}
    >
      <div className="dialog" role="dialog" aria-modal="true" onMouseDown={(e) => e.stopPropagation()}>
        <h2>Publish as a pull request</h2>
        <p className="muted">A new branch is created from the current default branch.</p>
        <form onSubmit={submit}>
          <label>
            Branch
            <input value={branch} onChange={(e) => setBranch(e.target.value)} required />
          </label>
          <label>
            Commit message
            <input value={commitMessage} onChange={(e) => setCommitMessage(e.target.value)} required />
          </label>
          <label>
            PR title
            <input value={title} onChange={(e) => setTitle(e.target.value)} required />
          </label>
          <label>
            PR body
            <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={4} />
          </label>
          <div className="changes">
            <strong>Files in this PR</strong>
            <ul>
              {files.map((file, index) => (
                <li key={`${file.change.path}-${index}`}>
                  <code>{file.change.path}</code>{' '}
                  <span className="muted">{describeFile(file)}</span>
                </li>
              ))}
            </ul>
          </div>
          {error && <p className="error">{error}</p>}
          {conflict && (
            <div className="conflict-hint">
              <p>The base branch moved since you opened this file. Reload to review the latest version before publishing.</p>
              <button type="button" onClick={onReload}>Reload file</button>
            </div>
          )}
          <div className="dialog-actions">
            <button type="button" onClick={onClose} disabled={busy}>Cancel</button>
            <button type="submit" className="primary" disabled={busy}>
              {busy ? 'Publishing…' : 'Publish PR'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
