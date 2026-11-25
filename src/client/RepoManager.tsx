import type { LocalRepoInfo } from '../shared/types'

interface Props {
  repos: LocalRepoInfo[]
  busy: boolean
  onAdd: () => void
  onRemove: (id: string) => void
}

export default function RepoManager({ repos, busy, onAdd, onRemove }: Props) {
  return (
    <div className="repo-manager">
      <div className="repo-manager-head">
        <span>Local repositories</span>
        <button type="button" className="bar-button" disabled={busy} onClick={onAdd}>
          {busy ? 'Adding…' : '+ Add'}
        </button>
      </div>
      {repos.length === 0 && <p className="hint">No folders added yet.</p>}
      {repos.map((repo) => (
        <div key={repo.id} className="repo-row">
          <span title={repo.path}>{repo.id}</span>
          <button
            type="button"
            className="discard-new"
            aria-label={`Remove ${repo.id}`}
            title={`Remove ${repo.id}`}
            disabled={busy}
            onClick={() => onRemove(repo.id)}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  )
}
