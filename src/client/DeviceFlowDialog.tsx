import { useEffect, useRef, useState } from 'react'
import { api } from './api'
import { desktopBridge } from './desktop'

interface Session {
  deviceCode: string
  userCode: string
  verificationUri: string
  interval: number
  expiresIn: number
}

interface Props {
  onClose: () => void
  onSuccess: (login: string) => void
}

export default function DeviceFlowDialog({ onClose, onSuccess }: Props) {
  const [session, setSession] = useState<Session | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const successRef = useRef(onSuccess)

  useEffect(() => { successRef.current = onSuccess }, [onSuccess])

  useEffect(() => {
    let cancelled = false
    api.githubDeviceStart()
      .then((result) => { if (!cancelled) setSession(result) })
      .catch((err: Error) => { if (!cancelled) setError(err.message) })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (!session) return
    let cancelled = false
    let timer = 0
    const poll = async () => {
      try {
        const result = await api.githubDevicePoll(session.deviceCode)
        if (cancelled) return
        if (!result.pending && result.login) {
          successRef.current(result.login)
          return
        }
        const seconds = result.slowDown ? session.interval + 5 : session.interval
        timer = window.setTimeout(poll, seconds * 1000)
      } catch (err) {
        if (!cancelled) setError((err as Error).message)
      }
    }
    timer = window.setTimeout(poll, session.interval * 1000)
    return () => { cancelled = true; window.clearTimeout(timer) }
  }, [session])

  const copy = async () => {
    if (!session) return
    try {
      await navigator.clipboard.writeText(session.userCode)
      setCopied(true)
    } catch {
      setError('Could not copy the code; select it manually')
    }
  }

  return (
    <div className="overlay" role="presentation" onMouseDown={onClose}>
      <div className="dialog" role="dialog" aria-modal="true" onMouseDown={(e) => e.stopPropagation()}>
        <h2>Sign in with GitHub</h2>
        {!session && !error && <p className="muted">Requesting a device code…</p>}
        {error && <p className="error">{error}</p>}
        {session && (
          <>
            <p className="muted">
              Open GitHub, enter this code, then authorize Marginalia. This window updates
              automatically. The code expires in {Math.round(session.expiresIn / 60)} minutes.
            </p>
            <code className="device-code">{session.userCode}</code>
            <div className="dialog-actions">
              <button type="button" onClick={() => void copy()}>{copied ? 'Copied' : 'Copy code'}</button>
              <button
                type="button"
                className="primary"
                onClick={() => {
                  if (desktopBridge) void desktopBridge.openExternal(session.verificationUri)
                  else window.open(session.verificationUri, '_blank', 'noopener,noreferrer')
                }}
              >
                Open GitHub
              </button>
            </div>
            <button type="button" className="link-button" onClick={onClose}>Cancel</button>
          </>
        )}
        {!session && (
          <div className="dialog-actions">
            <button type="button" onClick={onClose}>Cancel</button>
          </div>
        )}
      </div>
    </div>
  )
}
