import { useState, type FormEvent } from 'react'

interface Props {
  login: string | null
  onClose: () => void
  onSave: (token: string) => Promise<void>
  onClear: () => Promise<void>
}

export default function PatDialog({ login, onClose, onSave, onClear }: Props) {
  const [token, setToken] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const save = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await onSave(token)
      onClose()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const clear = async () => {
    setBusy(true)
    try {
      await onClear()
      onClose()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="overlay" role="presentation" onMouseDown={onClose}>
      <div className="dialog" role="dialog" aria-modal="true" onMouseDown={(e) => e.stopPropagation()}>
        <h2>GitHub personal access token</h2>
        <p className="muted">
          Needs <code>repo</code> scope for private repos (or <code>public_repo</code> for public ones).
          The token is validated with <code>GET /user</code> and held only in the server process —
          it is never stored in the browser.
        </p>
        {login && <p className="muted">Currently connected as <strong>{login}</strong>.</p>}
        <form onSubmit={save}>
          <label>
            PAT
            <input
              type="password"
              value={token}
              autoFocus
              placeholder="github_pat_…"
              onChange={(e) => setToken(e.target.value)}
              required
            />
          </label>
          {error && <p className="error">{error}</p>}
          <div className="dialog-actions">
            {login && (
              <button type="button" onClick={clear} disabled={busy}>
                Clear token
              </button>
            )}
            <button type="button" onClick={onClose} disabled={busy}>Cancel</button>
            <button type="submit" className="primary" disabled={busy || !token.trim()}>
              {busy ? 'Checking…' : 'Connect'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
