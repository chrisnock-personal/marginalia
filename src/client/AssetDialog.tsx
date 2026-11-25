import { useState } from 'react'

export interface AssetView {
  path: string
  staged: boolean
  deleted: boolean
}

interface Props {
  assets: AssetView[]
  assetSrc: (path: string) => string
  onRename: (oldPath: string, newPath: string) => void
  onDelete: (path: string) => void
  onClose: () => void
}

function AssetRow({
  asset,
  assetSrc,
  onRename,
  onDelete,
}: {
  asset: AssetView
  assetSrc: (path: string) => string
  onRename: (oldPath: string, newPath: string) => void
  onDelete: (path: string) => void
}) {
  const [draft, setDraft] = useState(asset.path)
  return (
    <div className={asset.deleted ? 'asset-row deleted' : 'asset-row'}>
      <div className="asset-thumb">
        {asset.deleted ? <span>✕</span> : asset.staged ? <span>new</span> : <img src={assetSrc(asset.path)} alt="" />}
      </div>
      <input
        aria-label={`Path for ${asset.path}`}
        value={draft}
        disabled={asset.deleted}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && draft.trim() && draft.trim() !== asset.path) onRename(asset.path, draft.trim())
        }}
      />
      <div className="asset-row-actions">
        <button
          type="button"
          disabled={asset.deleted || !draft.trim() || draft.trim() === asset.path}
          onClick={() => onRename(asset.path, draft.trim())}
        >
          Rename / move
        </button>
        <button type="button" disabled={asset.deleted} onClick={() => onDelete(asset.path)}>
          Delete
        </button>
      </div>
      <div className="muted asset-badges">
        {asset.staged && <span>staged in this session</span>}
        {asset.deleted && <span>removed in the PR</span>}
      </div>
    </div>
  )
}

export default function AssetDialog({ assets, assetSrc, onRename, onDelete, onClose }: Props) {
  return (
    <div className="overlay" role="presentation" onMouseDown={onClose}>
      <div className="dialog asset-dialog" role="dialog" aria-modal="true" aria-label="Asset manager" onMouseDown={(event) => event.stopPropagation()}>
        <h2>Images in this repository</h2>
        <p className="muted">
          Rename or move an image to rewrite its Markdown references in every file. Deleting removes the
          file and its image embeds in the published PR.
        </p>
        <div className="asset-list">
          {assets.length === 0 && <p className="empty-hint">No images yet. Paste, drop or upload one in the editor.</p>}
          {assets.map((asset) => (
            <AssetRow
              key={asset.path}
              asset={asset}
              assetSrc={assetSrc}
              onRename={onRename}
              onDelete={onDelete}
            />
          ))}
        </div>
        <div className="dialog-actions">
          <button type="button" className="primary" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  )
}
