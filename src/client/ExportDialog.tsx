import { useState } from 'react'

interface Props {
  title: string
  commentCount: number
  onClose: () => void
  onPrint: (includeComments: boolean) => void
  onDownload: (includeComments: boolean) => void
}

export default function ExportDialog({ title, commentCount, onClose, onPrint, onDownload }: Props) {
  const [includeComments, setIncludeComments] = useState(true)

  return (
    <div className="overlay" role="presentation" onMouseDown={onClose}>
      <div className="dialog" role="dialog" aria-modal="true" aria-label="Export document" onMouseDown={(event) => event.stopPropagation()}>
        <h2>Export document</h2>
        <p className="muted">Create a standalone HTML view with print styles. Use your browser’s “Save as PDF” in the print dialog.</p>
        <div className="changes">
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={includeComments}
              onChange={(event) => setIncludeComments(event.target.checked)}
            />
            Include {commentCount} comment{commentCount === 1 ? '' : 's'} in an appendix
          </label>
        </div>
        <div className="dialog-actions">
          <button type="button" onClick={onClose}>Cancel</button>
          <button type="button" onClick={() => onDownload(includeComments)}>Download HTML</button>
          <button type="button" className="primary" onClick={() => onPrint(includeComments)}>
            Print / Save as PDF
          </button>
        </div>
      </div>
    </div>
  )
}
