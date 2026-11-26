import { useState, type FormEvent } from 'react'

interface Props {
  defaultFolder: string
  folders: string[]
  onClose: () => void
  /** May throw a validation error, which the dialog shows inline. */
  onCreate: (name: string, folder: string) => void
}

export default function NewFileDialog({ defaultFolder, folders, onClose, onCreate }: Props) {
  const [name, setName] = useState('')
  const [folder, setFolder] = useState(defaultFolder)
  const [error, setError] = useState<string | null>(null)

  const submit = (event: FormEvent) => {
    event.preventDefault()
    setError(null)
    try {
      onCreate(name, folder)
      onClose()
    } catch (err) {
      setError((err as Error).message)
    }
  }

  return (
    <div className="overlay" role="presentation" onMouseDown={onClose}>
      <div className="dialog" role="dialog" aria-modal="true" onMouseDown={(e) => e.stopPropagation()}>
        <h2>New Markdown file</h2>
        <p className="muted">
          The file is added to the next pull request. Only <code>.md</code> and{' '}
          <code>.markdown</code> files are supported.
        </p>
        <form onSubmit={submit}>
          <label>
            File name
            <input
              autoFocus
              value={name}
              placeholder="onboarding.md"
              onChange={(e) => setName(e.target.value)}
              required
            />
          </label>
          <label>
            Folder
            <input
              value={folder}
              list="new-file-folders"
              placeholder={defaultFolder || 'repository root'}
              onChange={(e) => setFolder(e.target.value)}
            />
            <datalist id="new-file-folders">
              {folders.map((entry) => <option key={entry} value={entry} />)}
            </datalist>
          </label>
          {error && <p className="error">{error}</p>}
          <div className="dialog-actions">
            <button type="button" onClick={onClose}>Cancel</button>
            <button type="submit" className="primary" disabled={!name.trim()}>Create file</button>
          </div>
        </form>
      </div>
    </div>
  )
}
