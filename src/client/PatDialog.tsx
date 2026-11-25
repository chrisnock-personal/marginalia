import { useState, type FormEvent } from 'react'

interface Props {
  login: string | null
  oauthConfigured: boolean
  deviceFlowConfigured?: boolean
  desktop?: boolean
  onClose: () => void
  onSave: (token: string) => Promise<void>
  onClear: () => Promise<void>
  onOAuth: () => Promise<void>
  onDeviceFlow: () => void
}

export default function PatDialog({
  login,
  oauthConfigured,
  deviceFlowConfigured = false,
  desktop = false,
  onClose,
  onSave,
  onClear,
  onOAuth,
  onDeviceFlow,
}: Props) {
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

  const oauth = async () => {
    setBusy(true)
    setError(null)
    try {
      await onOAuth()
      onClose()
    } catch (err) {
      setError((err as Error).message)
      setBusy(false)
    }
  }

  return (
    <div className="overlay" role="presentation" onMouseDown={onClose}>
      <div className="dialog" role="dialog" aria-modal="true" onMouseDown={(e) => e.stopPropagation()}>
        <h2>Connect GitHub</h2>
        <p className="muted">
          Sign in with GitHub, or use a personal access token. Tokens are validated with
          <code> GET /user</code> and held in the server process; the desktop app keeps an encrypted
          copy in the system credential store, never in a plain file.
        </p>
        {deviceFlowConfigured && (
          <p>
            <button type="button" className="primary" onClick={onDeviceFlow} disabled={busy}>
              Sign in with a device code
            </button>
          </p>
        )}
        {!desktop && oauthConfigured && (
          <p>
            <button type="button" className="primary" onClick={oauth} disabled={busy}>
              Sign in with GitHub (OAuth)
            </button>
          </p>
        )}
        {login && <p className="muted">Currently connected as <strong>{login}</strong>.</p>}
        <form onSubmit={save}>
          <label>
            Personal access token
            <input
              type="password"
              value={token}
              placeholder="github_pat_…"
              onChange={(e) => setToken(e.target.value)}
              required
            />
          </label>
          <p className="muted">
            Classic tokens need <code>repo</code> for private repos (<code>public_repo</code> for public ones).
          </p>
          {error && <p className="error">{error}</p>}
          <div className="dialog-actions">
            {login && (
              <button type="button" onClick={clear} disabled={busy}>Clear token</button>
            )}
            <button type="button" onClick={onClose} disabled={busy}>Cancel</button>
            <button type="submit" className="primary" disabled={busy || !token.trim()}>
              {busy ? 'Checking…' : 'Connect with PAT'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
