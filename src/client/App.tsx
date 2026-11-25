import { useEffect, useRef, useState } from 'react'
import type { Editor as TiptapEditor } from '@tiptap/react'
import { emptyComments, newCommentId } from '../shared/comments'
import type {
  Comment,
  CommentAnchor,
  CommentsFile,
  FileChange,
  FileEntry,
  ImageTarget,
  ProviderId,
  ProviderInfo,
  PublishResult,
  RepoSummary,
} from '../shared/types'
import { api } from './api'
import AssetDialog, { type AssetView } from './AssetDialog'
import { relativeSrcFor, repoPathFor, rewriteReferences } from './assetPaths'
import CommentsPanel from './CommentsPanel'
import Editor from './Editor'
import { buildExportHtml, downloadHtml, printHtml } from './export'
import ExportDialog from './ExportDialog'
import PatDialog from './PatDialog'
import { previewToSrc, setImagePreview } from './repoImage'
import { buildPublishFiles } from './publishFiles'
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
  const [repoAssets, setRepoAssets] = useState<FileEntry[]>([])
  const [docEdits, setDocEdits] = useState<Record<string, string>>({})
  const [comments, setComments] = useState(emptyComments().comments)
  const [pendingAnchor, setPendingAnchor] = useState<CommentAnchor | null>(null)
  const [pendingTarget, setPendingTarget] = useState<ImageTarget | null>(null)
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
  const [assetOpen, setAssetOpen] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const [branch, setBranch] = useState('marginalia/edit')
  const editorRef = useRef<TiptapEditor | null>(null)
  const baseMarkdown = useRef<Record<string, string>>({})
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
    setRepoAssets([])
    setDocEdits({})
    baseMarkdown.current = {}
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
    setFiles([])
    setRepoAssets([])
    setDocEdits({})
    baseMarkdown.current = {}
    api.files(provider, repoId)
      .then((result) => { if (!cancelled) setFiles(result) })
      .catch((err: Error) => { if (!cancelled) setError(err.message) })
    api.assets(provider, repoId, baseRef)
      .then((result) => { if (!cancelled) setRepoAssets(result) })
      .catch((err: Error) => { if (!cancelled) setError(err.message) })
    return () => { cancelled = true }
  }, [provider, repoId, baseRef, reloadKey])

  useEffect(() => {
    if (!repoId || !path) return
    let cancelled = false
    setLoadingFile(true)
    setError(null)
    setPendingAnchor(null)
    setPendingTarget(null)
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
    const resolved = repoPathFor(path, src)
    return resolved ? api.assetSrc(provider, repoId, resolved, baseRef) : src
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

  /** Base Markdown for all files, cached until a reload/publish. */
  const loadBaseMarkdown = async (): Promise<Record<string, string>> => {
    if (Object.keys(baseMarkdown.current).length) return baseMarkdown.current
    const entries = files.length ? files : await api.files(provider, repoId)
    const pairs = await Promise.all(entries.map(async (entry) =>
      [entry.path, (await api.file(provider, repoId, entry.path)).content] as const,
    ))
    baseMarkdown.current = Object.fromEntries(pairs)
    return baseMarkdown.current
  }

  /** Apply an image rename/delete to every Markdown file that references it. */
  const rewriteAllReferences = async (oldPath: string, newPath: string | null) => {
    const base = await loadBaseMarkdown()
    const updates: Record<string, string> = {}
    const removed: string[] = []
    let currentFileUpdate: string | undefined
    for (const filePath of Object.keys(base)) {
      const current = filePath === path ? markdown : docEdits[filePath] ?? base[filePath]
      const next = rewriteReferences(current, filePath, oldPath, newPath)
      if (next === current) continue
      if (filePath === path) {
        currentFileUpdate = next
      } else if (next === base[filePath]) {
        removed.push(filePath)
      } else {
        updates[filePath] = next
      }
    }
    if (currentFileUpdate !== undefined) setMarkdown(currentFileUpdate)
    if (Object.keys(updates).length || removed.length) {
      setDocEdits((previous) => {
        const next = { ...previous, ...updates }
        for (const key of removed) delete next[key]
        return next
      })
    }
  }

  const checkAssetPath = (value: string): string => {
    const cleaned = value.trim().replace(/^\.\//, '')
    if (!cleaned || cleaned.startsWith('/') || /\\/.test(cleaned) ||
        cleaned.split('/').some((part) => !part || part === '.' || part === '..')) {
      throw new Error('Enter a repo-relative path such as docs/assets/photo.png')
    }
    return cleaned
  }

  const assetBytes = async (assetPath: string): Promise<string> => {
    const staged = assets.find((asset) => asset.path === assetPath && !asset.delete)
    if (staged?.encoding === 'base64') return staged.content
    return api.assetBase64(provider, repoId, assetPath, baseRef)
  }

  const renameAsset = async (oldPath: string, rawNewPath: string) => {
    try {
      const newPath = checkAssetPath(rawNewPath)
      if (newPath === oldPath) return
      if (assets.some((asset) => asset.path === newPath && !asset.delete)) {
        throw new Error(`An image already exists at ${newPath}`)
      }
      const bytesBase64 = await assetBytes(oldPath)
      const wasRepoAsset = repoAssets.some((asset) => asset.path === oldPath)
      await rewriteAllReferences(oldPath, newPath)
      // The new path is not in the base ref yet; preview the moved bytes locally.
      const bytes = Uint8Array.from(atob(bytesBase64), (char) => char.charCodeAt(0))
      setImagePreview(relativeSrcFor(path, newPath), URL.createObjectURL(new Blob([bytes])))
      setAssets((current) => {
        const rest = current.filter((asset) => asset.path !== oldPath && asset.path !== newPath)
        const moved: FileChange = { path: newPath, content: bytesBase64, encoding: 'base64' }
        if (!wasRepoAsset || current.some((asset) => asset.path === oldPath && asset.delete)) {
          return [...rest, moved]
        }
        // Keep the bytes on the deletion so the dialog can show this as a move;
        // the server ignores content when `delete` is set.
        return [...rest, moved, { path: oldPath, content: bytesBase64, delete: true }]
      })
      setComments((current) => current.map((comment) =>
        comment.target?.path === oldPath
          ? { ...comment, target: { ...comment.target, path: newPath } }
          : comment,
      ))
      setNotice(`Moved ${oldPath} → ${newPath}; Markdown references updated`)
    } catch (err) {
      setError((err as Error).message)
    }
  }

  const deleteAsset = async (assetPath: string) => {
    if (!window.confirm(`Delete ${assetPath} and remove its image embeds in the published PR?`)) return
    try {
      const wasRepoAsset = repoAssets.some((asset) => asset.path === assetPath)
      await rewriteAllReferences(assetPath, null)
      setAssets((current) => {
        const rest = current.filter((asset) => asset.path !== assetPath)
        if (!wasRepoAsset || current.some((asset) => asset.path === assetPath && asset.delete)) return rest
        return [...rest, { path: assetPath, content: '', delete: true }]
      })
      setComments((current) => current.filter((comment) => comment.target?.path !== assetPath))
      setNotice(`Deleted ${assetPath}; image embeds removed from Markdown`)
    } catch (err) {
      setError((err as Error).message)
    }
  }

  const commentsFile: CommentsFile = { version: 1, comments }
  const publishFileRows = buildPublishFiles({
    path, markdown, original, docEdits, assets, comments: commentsFile,
  })

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
        files: publishFileRows.map((row) => row.change),
        comments: commentsFile,
        pr: { title: values.title, body: values.body },
      })
      setPublishResult(result)
      setOriginal(markdown)
      setAssets([])
      setDocEdits({})
      baseMarkdown.current = {}
      setPublishOpen(false)
    } catch (err) {
      const message = (err as Error).message
      setPublishError(message)
      setPublishConflict(message.startsWith('Base branch changed'))
    } finally {
      setPublishing(false)
    }
  }

  const saveComment = (body: string, author: string, parentId?: string, target?: ImageTarget) => {
    const parent = parentId ? comments.find((comment) => comment.id === parentId) : undefined
    const anchor = parentId ? parent?.anchor : pendingAnchor
    const imageTarget = parentId ? parent?.target : target
    if (!anchor && !imageTarget) return
    setComments([
      ...comments,
      {
        id: newCommentId(),
        path,
        ...(anchor ? { anchor } : {}),
        ...(imageTarget ? { target: imageTarget } : {}),
        parentId,
        body,
        author,
        createdAt: new Date().toISOString(),
        resolved: false,
      },
    ])
    setPendingAnchor(null)
    setPendingTarget(null)
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
    setDocEdits({})
    baseMarkdown.current = {}
    setReloadKey((key) => key + 1)
  }

  const exportHtml = (includeComments: boolean): string => {
    // Editor HTML uses local preview URLs for staged/moved images; exports need
    // a URL that still resolves after the HTML is downloaded or printed.
    const html = (editorRef.current?.getHTML() ?? '').replace(
      /(<img\b[^>]*\bsrc\s*=\s*)(["'])(blob:[^"']+)\2/gi,
      (full, prefix: string, quote: string, url: string) => {
        const src = previewToSrc(url)
        const repoPath = src ? repoPathFor(path, src) : null
        return repoPath
          ? `${prefix}${quote}${api.assetSrc(provider, repoId, repoPath, baseRef)}${quote}`
          : full
      },
    )
    return buildExportHtml({
      title: path,
      html,
      comments: comments.filter((comment) => comment.path === path),
      includeComments,
    })
  }

  const github = config.find((p) => p.id === 'github')
  const anyConfigured = config.some((p) => p.configured)
  const dirty = markdown !== original || assets.length > 0 || Object.keys(docEdits).length > 0
  const assetPaths = [...new Set([...repoAssets.map((asset) => asset.path), ...assets.map((asset) => asset.path)])]
  const assetViews: AssetView[] = assetPaths.map((assetPath) => ({
    path: assetPath,
    staged: assets.some((asset) => asset.path === assetPath && !asset.delete && asset.encoding === 'base64'),
    deleted: assets.some((asset) => asset.path === assetPath && asset.delete),
  }))

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
                    {assets.length > 0 && ` · ${assets.length} file change(s) staged`}
                  </span>
                </div>
                <div className="doc-actions">
                  <button type="button" onClick={() => setExportOpen(true)}>Export</button>
                  <button type="button" onClick={() => setAssetOpen(true)}>
                    Assets ({assetViews.length})
                  </button>
                  <button type="button" className="primary" onClick={openPublish}>Publish PR</button>
                </div>
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
                docPath={path}
                markdown={markdown}
                comments={comments}
                resolveSrc={resolveSrc}
                onAsset={stageAsset}
                onChange={setMarkdown}
                onEditorReady={(instance) => { editorRef.current = instance }}
                onAddComment={(anchor, target) => {
                  if (!anchor && !target) setError('Select some text or click an image before adding a comment')
                  else { setError(null); setPendingAnchor(anchor); setPendingTarget(target ?? null) }
                }}
              />
            </>
          ) : (
            <div className="placeholder">
              <h2>Review and edit Markdown in context</h2>
              <p>Choose a repository and a file. Select text or click an image to leave a comment, then publish the edits and comments as a pull request.</p>
            </div>
          )}
        </main>

        <CommentsPanel
          path={path || null}
          comments={comments}
          pendingAnchor={pendingAnchor}
          pendingTarget={pendingTarget}
          onSave={saveComment}
          onCancel={() => { setPendingAnchor(null); setPendingTarget(null) }}
          onToggleResolved={toggleResolved}
          onDelete={deleteComment}
        />
      </div>

      {publishOpen && (
        <PublishDialog
          branch={branch}
          path={path}
          files={publishFileRows}
          busy={publishing}
          error={publishError}
          conflict={publishConflict}
          onClose={() => setPublishOpen(false)}
          onReload={reloadFile}
          onPublish={doPublish}
        />
      )}
      {assetOpen && (
        <AssetDialog
          assets={assetViews}
          assetSrc={(assetPath) => api.assetSrc(provider, repoId, assetPath, baseRef)}
          onRename={(oldPath, newPath) => { void renameAsset(oldPath, newPath) }}
          onDelete={(assetPath) => { void deleteAsset(assetPath) }}
          onClose={() => setAssetOpen(false)}
        />
      )}
      {exportOpen && (
        <ExportDialog
          title={path}
          commentCount={comments.filter((comment) => comment.path === path).length}
          onClose={() => setExportOpen(false)}
          onPrint={(includeComments) => {
            try {
              printHtml(exportHtml(includeComments))
              setExportOpen(false)
            } catch (err) {
              setError((err as Error).message)
            }
          }}
          onDownload={(includeComments) => {
            downloadHtml(path.replace(/\.(md|markdown)$/i, ''), exportHtml(includeComments))
            setExportOpen(false)
          }}
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
