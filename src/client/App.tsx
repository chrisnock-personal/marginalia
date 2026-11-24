import { useEffect, useState } from 'react'
import { emptyComments, newCommentId } from '../shared/comments'
import type {
  Comment,
  CommentAnchor,
  FileChange,
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
  const [assets, setAssets] = useState<FileChange[]>([])
  const [comments, setComments] = useState(emptyComments().comments)
  const [pendingAnchor, setPendingAnchor] = useState<CommentAnchor | null>(null)
  const [baseSha, setBaseSha] = useState('')
  const [reloadKey, setReloadKey] = useState(0)
  const [loadingFile, setLoadingFile] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [publishOpen, setPublishOpen] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [publishError, setPublishError] = useState<string | null>(null)
  const [publishConflict, setPublishConflict] = useState(false)
  const [publishResult, setPublishResult] = useState<PublishResult | null>(null)
  const [patOpen, setPatOpen] = useState(false)
  const [branch, setBranch] = useState('marginalia/edit')
  const baseRef = repos.find((repo) => repo.id === repoId)?.defaultBranch

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

    const auth = new URLSearchParams(window.location.search).get('auth')
    if (auth === 'success') {
      setNotice('Signed in with GitHub')
      refreshConfig().then(() => setProvider('github')).catch((err: Error) => setError(err.message))
    } else if (auth === 'error') {
      setError(`GitHub sign-in failed: ${new URLSearchParams(window.location.search).get('message') ?? 'unknown error'}`)
    }
    if (auth) window.history.replaceState({}, '', window.location.pathname)
  }, [])

  useEffect(() => {
    setRepoId('')
    setFiles([])
    setPath('')
    setAssets([])
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
    Promise.all([
      api.file(provider, repoId, path),
      api.comments(provider, repoId),
      api.head(provider, repoId, baseRef),
    ])
      .then(([file, loaded, head]) => {
        if (cancelled) return
        setOriginal(file.content)
        setMarkdown(file.content)
        setComments(loaded.comments)
        setBaseSha(head.sha)
        setPublishResult(null)
        setNotice(null)
      })
      .catch((err: Error) => { if (!cancelled) setError(err.message) })
      .finally(() => { if (!cancelled) setLoadingFile(false) })
    return () => { cancelled = true }
  }, [provider, repoId, path, repos, reloadKey])

  const selectRepo = (id: string) => {
    setRepoId(id)
    setPath('')
    setFiles([])
  }

  /** Show repo-relative images from the current branch/asset endpoint. */
  const resolveSrc = (src: string): string => {
    if (/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(src)) return src
    const dir = path.includes('/') ? path.slice(0, path.lastIndexOf('/') + 1) : ''
    const resolved = new URL(src, `https://marginalia.local/${dir}`).pathname.slice(1)
    return api.assetSrc(provider, repoId, resolved, baseRef)
  }

  /** Stage pasted/dropped image bytes so they travel in the same PR. */
  const stageAsset = (file: File, src: string) => {
    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = String(reader.result)
      const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1)
      const dir = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''
      const assetPath = [dir, src].filter(Boolean).join('/')
      setAssets((current) => [...current, { path: assetPath, content: base64, encoding: 'base64' }])
      setNotice(`Staged ${file.name} — it will be added to the PR`)
    }
    reader.readAsDataURL(file)
  }

  const openPublish = () => {
    const slug = path.split('/').pop()?.replace(/\.(md|markdown)$/i, '').replace(/[^a-z0-9]+/gi, '-').toLowerCase() ?? 'edit'
    setBranch(`marginalia/${slug}-${Date.now().toString(36)}`)
    setPublishError(null)
    setPublishConflict(false)
    setPublishOpen(true)
  }

  const doPublish = async (values: { branch: string; commitMessage: string; title: string; body: string }) => {
    setPublishing(true)
    setPublishError(null)
    try {
      const result = await api.publish({
        provider,
        repo: repoId,
        baseRef,
        baseSha,
        branch: values.branch,
        commitMessage: values.commitMessage,
        files: [
          ...(markdown === original ? [] : [{ path, content: markdown }]),
          ...assets,
        ],
        comments: { version: 1, comments },
        pr: { title: values.title, body: values.body },
      })
      setPublishResult(result)
      setOriginal(markdown)
      setAssets([])
      setPublishOpen(false)
    } catch (err) {
      const message = (err as Error).message
      setPublishError(message)
      setPublishConflict(message.startsWith('Base branch changed'))
    } finally {
      setPublishing(false)
    }
  }

  const saveComment = (body: string, author: string, parentId?: string) => {
    const anchor = parentId
      ? comments.find((comment) => comment.id === parentId)?.anchor
      : pendingAnchor
    if (!anchor || !path) return
    setComments([
      ...comments,
      {
        id: newCommentId(),
        path,
        anchor,
        parentId,
        body,
        author,
        createdAt: new Date().toISOString(),
        resolved: false,
      },
    ])
    if (!parentId) setPendingAnchor(null)
  }

  const toggleResolved = (id: string) => {
    const target = comments.find((comment) => comment.id === id)
    if (!target) return
    const resolved = !target.resolved
    setComments(comments.map((comment) =>
      comment.id === id || comment.parentId === id ? { ...comment, resolved } : comment,
    ))
  }

  const deleteComment = (id: string) => {
    setComments(comments.filter((comment) => comment.id !== id && comment.parentId !== id))
  }

  const reloadFile = () => {
    setPublishOpen(false)
    setAssets([])
    setReloadKey((key) => key + 1)
  }

  const github = config.find((p) => p.id === 'github')
  const anyConfigured = config.some((p) => p.configured)
  const dirty = markdown !== original || assets.length > 0

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
            GitHub sign-in{github?.detail ? ` · ${github.detail}` : ''}
          </button>
        </div>
      </header>

      {error && <div className="banner error-banner">{error}</div>}
      {notice && (
        <div className={notice.startsWith('Staged') ? 'banner info-banner' : 'banner success-banner'}>
          {notice}
        </div>
      )}
      {!anyConfigured && (
        <div className="banner setup-banner">
          No git source configured. Set <code>MARGINALIA_LOCAL_REPOS</code> to colon-separated repo
          paths, or connect with GitHub below.
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
                  onClick={() => { setPath(file.path); setAssets([]); setPublishResult(null) }}
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
                  <span className="muted">
                    {dirty ? 'Unpublished edits' : 'No local edits'} · {comments.filter((c) => c.path === path).length} comment(s)
                    {assets.length > 0 && ` · ${assets.length} image${assets.length === 1 ? '' : 's'} staged`}
                  </span>
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
                documentKey={`${provider}/${repoId}/${path}/${reloadKey}`}
                markdown={markdown}
                comments={comments}
                resolveSrc={resolveSrc}
                onAsset={stageAsset}
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
          onToggleResolved={toggleResolved}
          onDelete={deleteComment}
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
          conflict={publishConflict}
          onClose={() => setPublishOpen(false)}
          onReload={reloadFile}
          onPublish={doPublish}
        />
      )}
      {patOpen && (
        <PatDialog
          login={github?.detail?.replace('Authenticated as ', '') ?? null}
          oauthConfigured={Boolean(github?.oauthConfigured)}
          onClose={() => setPatOpen(false)}
          onOAuth={async () => {
            const { url } = await api.oauthUrl()
            window.location.href = url
          }}
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
