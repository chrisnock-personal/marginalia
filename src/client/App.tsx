import { useEffect, useState } from 'react'
import { emptyComments, newCommentId } from '../shared/comments'
import type {
  Comment,
  CommentAnchor,
  FileEntry,
  ProviderId,
  ProviderInfo,
  PublishResult,
  RepoSummary,
} from '../shared/types'
import { api } from './api'
import CommentsPanel from './CommentsPanel'
import Editor from './Editor'
import PatDialog from './PatDialog'
import PublishDialog from './PublishDialog'

export default function App() {
  const [config, setConfig] = useState<ProviderInfo[]>([])
  const [provider, setProvider] = useState<ProviderId>('local')
  const [repos, setRepos] = useState<RepoSummary[]>([])
  const [repoId, setRepoId] = useState('')
  const [files, setFiles] = useState<FileEntry[]>([])
  const [path, setPath] = useState('')
  const [original, setOriginal] = useState('')
  const [markdown, setMarkdown] = useState('')
  const [comments, setComments] = useState(emptyComments().comments)
  const [pendingAnchor, setPendingAnchor] = useState<CommentAnchor | null>(null)
  const [loadingFile, setLoadingFile] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [publishOpen, setPublishOpen] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [publishError, setPublishError] = useState<string | null>(null)
  const [publishResult, setPublishResult] = useState<PublishResult | null>(null)
  const [patOpen, setPatOpen] = useState(false)
  const [branch, setBranch] = useState('marginalia/edit')

  const refreshConfig = async () => {
    const result = await api.config()
    setConfig(result.providers)
    return result.providers
  }

  useEffect(() => {
    refreshConfig()
      .then((providers) => {
        const first = providers.find((p) => p.id === 'local' && p.configured)
          ?? providers.find((p) => p.configured)
        if (first) setProvider(first.id)
      })
      .catch((err: Error) => setError(err.message))
  }, [])

  useEffect(() => {
    setRepoId('')
    setFiles([])
    setPath('')
    setPublishResult(null)
    const info = config.find((p) => p.id === provider)
    if (!info?.configured) return
    let cancelled = false
    api.repos(provider)
      .then((result) => { if (!cancelled) setRepos(result) })
      .catch((err: Error) => { if (!cancelled) setError(err.message) })
    return () => { cancelled = true }
  }, [provider, config])

  useEffect(() => {
    if (!repoId) return
    let cancelled = false
    api.files(provider, repoId)
      .then((result) => { if (!cancelled) setFiles(result) })
      .catch((err: Error) => { if (!cancelled) setError(err.message) })
    return () => { cancelled = true }
  }, [provider, repoId])

  useEffect(() => {
    if (!repoId || !path) return
    let cancelled = false
    setLoadingFile(true)
    setError(null)
    setPendingAnchor(null)
    Promise.all([api.file(provider, repoId, path), api.comments(provider, repoId)])
      .then(([file, loaded]) => {
        if (cancelled) return
        setOriginal(file.content)
        setMarkdown(file.content)
        setComments(loaded.comments)
        setPublishResult(null)
      })
      .catch((err: Error) => { if (!cancelled) setError(err.message) })
      .finally(() => { if (!cancelled) setLoadingFile(false) })
    return () => { cancelled = true }
  }, [provider, repoId, path])

  const selectRepo = (id: string) => {
    setRepoId(id)
    setPath('')
    setFiles([])
  }

  const openPublish = () => {
    const slug = path.split('/').pop()?.replace(/\.(md|markdown)$/i, '').replace(/[^a-z0-9]+/gi, '-').toLowerCase() ?? 'edit'
    setBranch(`marginalia/${slug}-${Date.now().toString(36)}`)
    setPublishError(null)
    setPublishOpen(true)
  }

  const doPublish = async (values: { branch: string; commitMessage: string; title: string; body: string }) => {
    setPublishing(true)
    setPublishError(null)
    try {
      const result = await api.publish({
        provider,
        repo: repoId,
        baseRef: repos.find((repo) => repo.id === repoId)?.defaultBranch,
        branch: values.branch,
        commitMessage: values.commitMessage,
        files: markdown === original ? [] : [{ path, content: markdown }],
        comments: { version: 1, comments },
        pr: { title: values.title, body: values.body },
      })
      setPublishResult(result)
      setPublishOpen(false)
    } catch (err) {
      setPublishError((err as Error).message)
    } finally {
      setPublishing(false)
    }
  }

  const saveComment = (body: string, author: string) => {
    if (!pendingAnchor || !path) return
    setComments([
      ...comments,
      {
        id: newCommentId(),
        path,
        anchor: pendingAnchor,
        body,
        author,
        createdAt: new Date().toISOString(),
        resolved: false,
      },
    ])
    setPendingAnchor(null)
  }

  const github = config.find((p) => p.id === 'github')
  const anyConfigured = config.some((p) => p.configured)
  const dirty = markdown !== original

  return (
    <div className="app">
      <header className="app-header">
        <div className="brand">
          <span className="logo">M</span>
          <div>
            <h1>Marginalia</h1>
            <p>Markdown editing with margin notes and PR publishing</p>
          </div>
        </div>
        <div className="header-actions">
          <select value={provider} onChange={(e) => setProvider(e.target.value as ProviderId)}>
            {config.map((info) => (
              <option key={info.id} value={info.id} disabled={!info.configured}>
                {info.label}{info.configured ? '' : ' (not connected)'}
              </option>
            ))}
          </select>
          <button type="button" onClick={() => setPatOpen(true)}>
            GitHub PAT{github?.detail ? ` · ${github.detail}` : ''}
          </button>
        </div>
      </header>

      {error && <div className="banner error-banner">{error}</div>}
      {!anyConfigured && (
        <div className="banner setup-banner">
          No git source configured. Set <code>MARGINALIA_LOCAL_REPOS</code> to colon-separated repo
          paths, or connect with a GitHub PAT below.
        </div>
      )}

      <div className="workspace">
        <nav className="file-sidebar">
          <h2>Repository</h2>
          <select value={repoId} onChange={(e) => selectRepo(e.target.value)} disabled={!anyConfigured}>
            <option value="">Choose a repo…</option>
            {repos.map((repo) => (
              <option key={repo.id} value={repo.id}>{repo.fullName}</option>
            ))}
          </select>
          <h2>Markdown files</h2>
          <ul className="file-list">
            {files.map((file) => (
              <li key={file.path}>
                <button
                  type="button"
                  className={file.path === path ? 'file active' : 'file'}
                  onClick={() => { setPath(file.path); setPublishResult(null) }}
                >
                  {file.path.split('/').pop()}
                </button>
              </li>
            ))}
          </ul>
          {repoId && files.length === 0 && <p className="empty-hint">No Markdown files found.</p>}
        </nav>

        <main className="main-pane">
          {path ? (
            <>
              <div className="doc-header">
                <div>
                  <h2>{path}</h2>
                  <span className="muted">{dirty ? 'Unpublished edits' : 'No local edits'} · {comments.filter((c) => c.path === path).length} comment(s)</span>
                </div>
                <button type="button" className="primary" onClick={openPublish}>Publish PR</button>
              </div>
              {loadingFile && <p className="muted">Loading document…</p>}
              {publishResult && (
                <div className="banner success-banner">
                  Published branch <code>{publishResult.branch}</code>
                  {publishResult.prUrl && <> · <a href={publishResult.prUrl} target="_blank" rel="noreferrer">Open PR</a></>}
                  {publishResult.notes.map((note) => <span key={note}> · {note}</span>)}
                </div>
              )}
              <Editor
                documentKey={`${provider}/${repoId}/${path}`}
                markdown={markdown}
                comments={comments}
                onChange={setMarkdown}
                onAddComment={(anchor) => {
                  if (!anchor) setError('Select some text before adding a comment')
                  else { setError(null); setPendingAnchor(anchor) }
                }}
              />
            </>
          ) : (
            <div className="placeholder">
              <h2>Review and edit Markdown in context</h2>
              <p>Choose a repository and a file. Select text to leave a comment, then publish the edits and comments as a pull request.</p>
            </div>
          )}
        </main>

        <CommentsPanel
          path={path || null}
          comments={comments}
          pendingAnchor={pendingAnchor}
          onSave={saveComment}
          onCancel={() => setPendingAnchor(null)}
          onToggleResolved={(id) => setComments(comments.map((c) => c.id === id ? { ...c, resolved: !c.resolved } : c))}
          onDelete={(id) => setComments(comments.filter((c) => c.id !== id))}
        />
      </div>

      {publishOpen && (
        <PublishDialog
          branch={branch}
          path={path}
          dirty={dirty}
          comments={comments.length}
          busy={publishing}
          error={publishError}
          onClose={() => setPublishOpen(false)}
          onPublish={doPublish}
        />
      )}
      {patOpen && (
        <PatDialog
          login={github?.detail?.replace('Authenticated as ', '') ?? null}
          onClose={() => setPatOpen(false)}
          onSave={async (token) => { await api.setToken(token); await refreshConfig(); setProvider('github') }}
          onClear={async () => {
            await api.clearToken()
            const providers = await refreshConfig()
            if (provider === 'github' && providers.some((p) => p.id === 'local' && p.configured)) setProvider('local')
          }}
        />
      )}
    </div>
  )
}
