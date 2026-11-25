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
import { updateDocEdit } from './docEdits'
import Editor from './Editor'
import Logo from './Logo'
import { buildExportHtml, downloadHtml, inlineImageSources, printHtml, resolveExportImageSource } from './export'
import ExportDialog from './ExportDialog'
import { newMarkdownFile } from './newFile'
import NewFileDialog from './NewFileDialog'
import PatDialog from './PatDialog'
import { clearImagePreviews, previewToSrc, removeImagePreview, setImagePreview } from './repoImage'
import { buildPublishFiles } from './publishFiles'
import PublishDialog from './PublishDialog'

interface Panels { files: boolean; comments: boolean }
const PANELS_KEY = 'marginalia.panels'

function loadPanels(): Panels {
  try {
    const saved = JSON.parse(localStorage.getItem(PANELS_KEY) ?? '{}') as Partial<Panels>
    return { files: saved.files ?? true, comments: saved.comments ?? true }
  } catch {
    return { files: true, comments: true }
  }
}

/** Close the <details> menu a button sits in. */
function closeMenu(event: { currentTarget: HTMLElement }) {
  event.currentTarget.closest('details')?.removeAttribute('open')
}

/** Group files by folder, root files first, both alphabetical. */
function groupByFolder(files: FileEntry[]): Array<[string, FileEntry[]]> {
  const groups = new Map<string, FileEntry[]>()
  for (const file of [...files].sort((a, b) => a.path.localeCompare(b.path))) {
    const slash = file.path.lastIndexOf('/')
    const folder = slash >= 0 ? file.path.slice(0, slash) : ''
    groups.set(folder, [...(groups.get(folder) ?? []), file])
  }
  return [...groups].sort(([a], [b]) => (a === '' ? -1 : b === '' ? 1 : a.localeCompare(b)))
}

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
  // Staged image path -> Markdown file it was pasted into, so discarding a new
  // file can also discard its images.
  const [assetDocs, setAssetDocs] = useState<Record<string, string>>({})
  // New path -> original repo path for staged moves. Only used to label rows in
  // the publish dialog; never sent to the API.
  const [movedFrom, setMovedFrom] = useState<Record<string, string>>({})
  const [repoAssets, setRepoAssets] = useState<FileEntry[]>([])
  const [docEdits, setDocEdits] = useState<Record<string, string>>({})
  // New Markdown files have no base commit, so their content lives here until
  // publish rather than in docEdits.
  const [newFiles, setNewFiles] = useState<Record<string, string>>({})
  const [comments, setComments] = useState(emptyComments().comments)
  const [commentsDirty, setCommentsDirty] = useState(false)
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
  // Side panels can be hidden so only the writing column remains; the choice
  // is remembered per browser.
  const [panels, setPanels] = useState(loadPanels)
  // On phones the file list steps aside once a file is opened.
  const [narrowHidden, setNarrowHidden] = useState(false)
  const togglePanel = (panel: keyof Panels) => {
    if (panel === 'files' && narrowHidden) {
      setNarrowHidden(false)
      if (panels.files) return
    }
    setPanels((current) => {
      const next = { ...current, [panel]: !current[panel] }
      try { localStorage.setItem(PANELS_KEY, JSON.stringify(next)) } catch { /* storage unavailable */ }
      return next
    })
  }
  const [assetOpen, setAssetOpen] = useState(false)
  const [newFileOpen, setNewFileOpen] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const [branch, setBranch] = useState('marginalia/edit')
  const editorRef = useRef<TiptapEditor | null>(null)
  const baseMarkdown = useRef<Record<string, string>>({})
  // Read by the load effect, which must not re-run on every keystroke.
  const docEditsRef = useRef(docEdits)
  const newFilesRef = useRef(newFiles)
  const commentsLoaded = useRef('')
  const baseRef = repos.find((repo) => repo.id === repoId)?.defaultBranch

  useEffect(() => { docEditsRef.current = docEdits }, [docEdits])
  useEffect(() => { newFilesRef.current = newFiles }, [newFiles])

  /** Store an edit under its path so switching files cannot lose it. */
  const writeDocEdit = (filePath: string, content: string) => {
    if (filePath in newFilesRef.current) {
      setNewFiles((current) => ({ ...current, [filePath]: content }))
    } else {
      const base = filePath === path ? original : baseMarkdown.current[filePath] ?? ''
      setDocEdits((current) => updateDocEdit(current, filePath, content, base))
    }
    if (filePath === path) setMarkdown(content)
  }

  /** Open another file without discarding edits, images, moves or comments. */
  const openFile = (filePath: string) => {
    if (filePath === path) return
    setPath(filePath)
    setPendingAnchor(null)
    setPendingTarget(null)
    setPublishResult(null)
    setNotice(null)
    if (window.matchMedia('(max-width: 760px)').matches) setNarrowHidden(true)
  }

  /** Validate and stage a brand-new Markdown file, then open it. */
  const createNewFile = (name: string, folder: string) => {
    if (!repoId) throw new Error('Choose a repository first')
    const created = newMarkdownFile(name, folder)
    if (files.some((file) => file.path === created.path) || created.path in newFiles) {
      throw new Error(`${created.path} already exists in this repository`)
    }
    setNewFiles((current) => ({ ...current, [created.path]: created.content }))
    openFile(created.path)
    setNotice(`Created ${created.path}; it will be added to the PR`)
  }

  /** Remove an unpublished new file, its comments and the images staged in it. */
  const discardNewFile = (filePath: string) => {
    const stagedPaths = assets.filter((asset) => assetDocs[asset.path] === filePath).map((asset) => asset.path)
    for (const assetPath of stagedPaths) removeImagePreview(relativeSrcFor(filePath, assetPath))
    setNewFiles((current) => {
      const { [filePath]: _discarded, ...rest } = current
      return rest
    })
    setDocEdits((current) => {
      const { [filePath]: _discarded, ...rest } = current
      return rest
    })
    setAssets((current) => current.filter((asset) => !stagedPaths.includes(asset.path)))
    setAssetDocs((current) => {
      const rest = { ...current }
      for (const assetPath of stagedPaths) delete rest[assetPath]
      return rest
    })
    setMovedFrom((current) => {
      const rest = { ...current }
      for (const [newPath, oldPath] of Object.entries(rest)) {
        if (stagedPaths.includes(newPath) || stagedPaths.includes(oldPath)) delete rest[newPath]
      }
      return rest
    })
    if (comments.some((comment) => comment.path === filePath)) setCommentsDirty(true)
    setComments((current) => current.filter((comment) => comment.path !== filePath))
    if (path === filePath) {
      setPath('')
      setMarkdown('')
      setOriginal('')
    }
    setNotice(`Discarded ${filePath}`)
  }

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
    setAssetDocs({})
    setMovedFrom({})
    setRepoAssets([])
    setDocEdits({})
    setNewFiles({})
    baseMarkdown.current = {}
    setComments(emptyComments().comments)
    setCommentsDirty(false)
    commentsLoaded.current = ''
    clearImagePreviews()
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
    setAssets([])
    setAssetDocs({})
    setMovedFrom({})
    setDocEdits({})
    setNewFiles({})
    setMarkdown('')
    setOriginal('')
    setComments(emptyComments().comments)
    setCommentsDirty(false)
    commentsLoaded.current = ''
    baseMarkdown.current = {}
    clearImagePreviews()
    api.files(provider, repoId, baseRef)
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
    // Comments belong to the repository, so read them only once per reload;
    // switching pages must not throw away notes written on the previous one.
    const commentsKey = `${provider}/${repoId}/${reloadKey}`
    const needComments = commentsLoaded.current !== commentsKey
    const newContent = newFilesRef.current[path]
    // Read the page at the exact commit the publish will build on and check
    // against, so stale text can never be written over newer work. A new file
    // has no base content, so its staged text is used instead of GET /file.
    api.head(provider, repoId, baseRef)
      .then((head) => Promise.all([
        newContent !== undefined
          ? Promise.resolve({ path, content: newContent })
          : api.file(provider, repoId, path, head.sha),
        needComments ? api.comments(provider, repoId, head.sha) : Promise.resolve(null),
        head,
      ]))
      .then(([file, loaded, head]) => {
        if (cancelled) return
        setOriginal(newContent !== undefined ? '' : file.content)
        setMarkdown(
          newContent !== undefined
            ? (newFilesRef.current[path] ?? file.content)
            : (docEditsRef.current[path] ?? file.content),
        )
        if (loaded) {
          setComments(loaded.comments)
          setCommentsDirty(false)
          commentsLoaded.current = commentsKey
        }
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
      setAssetDocs((current) => ({ ...current, [assetPath]: path }))
      setNotice(`Staged ${file.name} — it will be added to the PR`)
    }
    reader.readAsDataURL(file)
  }

  /** Base Markdown for all files, cached until a reload/publish. */
  const loadBaseMarkdown = async (): Promise<Record<string, string>> => {
    if (Object.keys(baseMarkdown.current).length) return baseMarkdown.current
    const ref = baseSha || baseRef
    const entries = files.length ? files : await api.files(provider, repoId, ref)
    const pairs = await Promise.all(entries.map(async (entry) =>
      [entry.path, (await api.file(provider, repoId, entry.path, ref)).content] as const,
    ))
    baseMarkdown.current = Object.fromEntries(pairs)
    return baseMarkdown.current
  }

  /** Apply an image rename/delete to every Markdown file that references it. */
  const rewriteAllReferences = async (oldPath: string, newPath: string | null) => {
    const base = await loadBaseMarkdown()
    const updates: Record<string, string> = {}
    for (const filePath of [...Object.keys(base), ...Object.keys(newFiles)]) {
      const current = newFiles[filePath] ?? docEdits[filePath] ?? base[filePath]
      const next = rewriteReferences(current, filePath, oldPath, newPath)
      if (next !== current) updates[filePath] = next
    }
    for (const [filePath, content] of Object.entries(updates)) writeDocEdit(filePath, content)
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
        return [...rest, moved, { path: oldPath, content: '', delete: true }]
      })
      setMovedFrom((current) => {
        const { [oldPath]: origin = oldPath, ...rest } = current
        return origin === newPath ? rest : { ...rest, [newPath]: origin }
      })
      setAssetDocs((current) => {
        const owner = current[oldPath]
        const { [oldPath]: _old, ...rest } = current
        return owner ? { ...rest, [newPath]: owner } : rest
      })
      setComments((current) => current.map((comment) =>
        comment.target?.path === oldPath
          ? { ...comment, target: { ...comment.target, path: newPath } }
          : comment,
      ))
      setCommentsDirty(true)
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
      setMovedFrom((current) => {
        const { [assetPath]: _removed, ...rest } = current
        return rest
      })
      setAssetDocs((current) => {
        const { [assetPath]: _removed, ...rest } = current
        return rest
      })
      setComments((current) => current.filter((comment) => comment.target?.path !== assetPath))
      setCommentsDirty(true)
      setNotice(`Deleted ${assetPath}; image embeds removed from Markdown`)
    } catch (err) {
      setError((err as Error).message)
    }
  }

  const commentsFile: CommentsFile = { version: 1, comments }
  const publishFileRows = buildPublishFiles({
    docEdits, newFiles, assets, movedFrom, comments: commentsFile,
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
        // comments.json goes in `comments`; its row is only for the dialog.
        files: publishFileRows.filter((row) => row.status !== 'comments').map((row) => row.change),
        comments: commentsFile,
        pr: { title: values.title, body: values.body },
      })
      setPublishResult(result)
      setOriginal(markdown)
      setFiles((current) => [
        ...current,
        ...Object.keys(newFiles)
          .filter((newPath) => !current.some((file) => file.path === newPath))
          .map((newPath) => ({ path: newPath, type: 'blob' as const })),
      ])
      setAssets([])
      setAssetDocs({})
      setMovedFrom({})
      setDocEdits({})
      setNewFiles({})
      setCommentsDirty(false)
      baseMarkdown.current = {}
      clearImagePreviews()
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
    setCommentsDirty(true)
  }

  const toggleResolved = (id: string) => {
    const target = comments.find((comment) => comment.id === id)
    if (!target) return
    const resolved = !target.resolved
    setComments(comments.map((comment) =>
      comment.id === id || comment.parentId === id ? { ...comment, resolved } : comment,
    ))
    setCommentsDirty(true)
  }

  const deleteComment = (id: string) => {
    setComments(comments.filter((comment) => comment.id !== id && comment.parentId !== id))
    setCommentsDirty(true)
  }

  const reloadFile = () => {
    setPublishOpen(false)
    setAssets([])
    setAssetDocs({})
    setMovedFrom({})
    setDocEdits({})
    setNewFiles({})
    setCommentsDirty(false)
    commentsLoaded.current = ''
    baseMarkdown.current = {}
    clearImagePreviews()
    setReloadKey((key) => key + 1)
  }

  const exportHtml = async (includeComments: boolean): Promise<string> => {
    // Editor HTML contains blob previews, API asset URLs and external URLs.
    // Inline them all so the downloaded file works without this server.
    const resolved = new Map<string, Promise<string | null>>()
    const html = await inlineImageSources(editorRef.current?.getHTML() ?? '', (src) => {
      let pending = resolved.get(src)
      if (!pending) {
        pending = resolveExportImageSource(src, {
          docPath: path,
          provider,
          repoId,
          baseRef,
          assets,
          previewToSrc,
          assetBase64: api.assetBase64,
        })
        resolved.set(src, pending)
      }
      return pending
    })
    return buildExportHtml({
      title: path,
      html,
      comments: comments.filter((comment) => comment.path === path),
      includeComments,
    })
  }

  const github = config.find((p) => p.id === 'github')
  const anyConfigured = config.some((p) => p.configured)
  const dirty = Object.keys(docEdits).length > 0 || Object.keys(newFiles).length > 0 ||
    assets.length > 0 || commentsDirty

  useEffect(() => {
    if (!dirty) return
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  const assetPaths = [...new Set([...repoAssets.map((asset) => asset.path), ...assets.map((asset) => asset.path)])]
  const assetViews: AssetView[] = assetPaths.map((assetPath) => ({
    path: assetPath,
    staged: assets.some((asset) => asset.path === assetPath && !asset.delete && asset.encoding === 'base64'),
    deleted: assets.some((asset) => asset.path === assetPath && asset.delete),
  }))

  const docComments = comments.filter((comment) => comment.path === path)
  const changedFiles = publishFileRows.filter((row) => row.status !== 'comments').length
  const newEntries: FileEntry[] = Object.keys(newFiles)
    .filter((newPath) => !files.some((file) => file.path === newPath))
    .map((newPath) => ({ path: newPath, type: 'blob' }))
  const visibleFiles = [...files, ...newEntries]
  const fileGroups = groupByFolder(visibleFiles)
  const folders = [...new Set(visibleFiles.map((file) => {
    const index = file.path.lastIndexOf('/')
    return index >= 0 ? file.path.slice(0, index) : ''
  }).filter(Boolean))].sort((a, b) => a.localeCompare(b))
  const defaultFolder = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''
  const isNewFile = path in newFiles
  const slash = path.lastIndexOf('/')

  const filesOpen = panels.files && !narrowHidden
  const commentsOpen = Boolean(path) && panels.comments
  const statusText = dirty
    ? `${changedFiles} ${changedFiles === 1 ? 'file' : 'files'} changed`
    : 'No edits'

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar-left">
          <button
            type="button"
            className="icon-button"
            aria-label={filesOpen ? 'Hide files' : 'Show files'}
            aria-pressed={filesOpen}
            aria-controls="files-panel"
            onClick={() => togglePanel('files')}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
              <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" />
              <line x1="6" y1="2.5" x2="6" y2="13.5" />
            </svg>
          </button>
          {path && (
            <div className="doc-title">
              <h1>
                {slash >= 0 && <span className="doc-folder">{path.slice(0, slash + 1)}</span>}
                {path.slice(slash + 1)}
              </h1>
              <span className={dirty ? 'doc-status dirty' : 'doc-status'}>{statusText}</span>
            </div>
          )}
        </div>

        <Logo />

        <div className="topbar-right">
          {path && (
            <>
              <button type="button" className="bar-button wide-only" onClick={() => setExportOpen(true)}>Export</button>
              <button type="button" className="bar-button wide-only" onClick={() => setAssetOpen(true)}>
                Images{assetViews.length > 0 && <span className="bar-count">{assetViews.length}</span>}
              </button>
              <button
                type="button"
                className="bar-button wide-only"
                aria-pressed={commentsOpen}
                aria-controls="comments-panel"
                onClick={() => togglePanel('comments')}
              >
                Comments{docComments.length > 0 && <span className="bar-count">{docComments.length}</span>}
              </button>
              <details className="more narrow-only">
                <summary aria-label="More actions">
                  <svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                    <circle cx="3" cy="8" r="1.3" /><circle cx="8" cy="8" r="1.3" /><circle cx="13" cy="8" r="1.3" />
                  </svg>
                </summary>
                <div className="more-menu">
                  {repoId && (
                    <button type="button" onClick={(e) => { closeMenu(e); setNewFileOpen(true) }}>New file</button>
                  )}
                  <button type="button" onClick={(e) => { closeMenu(e); setExportOpen(true) }}>Export</button>
                  <button type="button" onClick={(e) => { closeMenu(e); setAssetOpen(true) }}>Images ({assetViews.length})</button>
                  <button type="button" onClick={(e) => { closeMenu(e); togglePanel('comments') }}>
                    {commentsOpen ? 'Hide comments' : `Show comments (${docComments.length})`}
                  </button>
                </div>
              </details>
              <button type="button" className="primary" onClick={openPublish}>Publish</button>
            </>
          )}
        </div>
      </header>

      {error && <div className="banner error-banner" role="alert">{error}</div>}
      {notice && <div className="banner" role="status">{notice}</div>}
      {publishResult && (
        <div className="banner success-banner" role="status">
          Published branch <code>{publishResult.branch}</code>.
          {publishResult.prUrl && <> <a href={publishResult.prUrl} target="_blank" rel="noreferrer">Open the pull request</a>.</>}
          {publishResult.notes.map((note) => <span key={note}> {note}.</span>)}
        </div>
      )}
      {!anyConfigured && (
        <div className="banner">
          No git source configured. Set <code>MARGINALIA_LOCAL_REPOS</code> to colon-separated repo
          paths, or connect GitHub from the file panel.
        </div>
      )}

      <div className="workspace">
        {filesOpen && (
          <nav id="files-panel" className="files-panel" aria-label="Files">
            <div className="source">
              <select aria-label="Source" value={provider} onChange={(e) => setProvider(e.target.value as ProviderId)}>
                {config.map((info) => (
                  <option key={info.id} value={info.id} disabled={!info.configured}>
                    {info.label}{info.configured ? '' : ' (not connected)'}
                  </option>
                ))}
              </select>
              <select
                aria-label="Repository"
                className="repo-select"
                value={repoId}
                onChange={(e) => selectRepo(e.target.value)}
                disabled={!anyConfigured}
              >
                <option value="">Choose a repository…</option>
                {repos.map((repo) => (
                  <option key={repo.id} value={repo.id}>{repo.fullName}</option>
                ))}
              </select>
            </div>
            <button
              type="button"
              className="bar-button new-file"
              disabled={!repoId}
              onClick={() => setNewFileOpen(true)}
            >
              + New file
            </button>
            <div className="file-tree">
              {repoId && visibleFiles.length === 0 && <p className="hint">No Markdown files in this repository.</p>}
              {fileGroups.map(([folder, entries]) => (
                <div key={folder} className="file-group">
                  {folder && <h2 className="folder">{folder}</h2>}
                  <ul className="file-list">
                    {entries.map((file) => (
                      <li key={file.path} className={file.path in newFiles ? 'file-row new' : 'file-row'}>
                        <button
                          type="button"
                          className={`file${file.path === path ? ' active' : ''}${file.path in newFiles ? ' file-new' : ''}`}
                          aria-current={file.path === path ? 'page' : undefined}
                          onClick={() => openFile(file.path)}
                        >
                          {file.path.split('/').pop()}
                          {file.path in newFiles && <span className="new-badge">new</span>}
                        </button>
                        {file.path in newFiles && (
                          <button
                            type="button"
                            className="discard-new"
                            aria-label={`Discard ${file.path}`}
                            title="Discard this new file"
                            onClick={() => discardNewFile(file.path)}
                          >
                            ×
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
            <button type="button" className="bar-button signin" onClick={() => setPatOpen(true)}>
              {github?.detail ? github.detail.replace('Authenticated as ', 'GitHub: ') : 'Connect GitHub'}
            </button>
          </nav>
        )}

        <main className="writing">
          {path ? (
            <>
              {loadingFile && <p className="hint loading">Loading…</p>}
              <Editor
                documentKey={`${provider}/${repoId}/${path}/${reloadKey}`}
                docPath={path}
                markdown={markdown}
                sourceMarkdown={original}
                comments={docComments}
                resolveSrc={resolveSrc}
                onAsset={stageAsset}
                onChange={(content) => writeDocEdit(path, content)}
                onEditorReady={(instance) => { editorRef.current = instance }}
                onAddComment={(anchor, target) => {
                  if (!anchor && !target) setError('Select some text or click an image before adding a comment')
                  else {
                    setError(null); setPendingAnchor(anchor); setPendingTarget(target ?? null)
                    if (!panels.comments) togglePanel('comments')
                  }
                }}
              />
            </>
          ) : (
            <div className="empty">
              <p>
                {repoId
                  ? 'Open a file to start writing.'
                  : anyConfigured
                    ? 'Choose a repository, then open a file to start writing.'
                    : 'Connect a git source to start writing.'}
              </p>
              {repoId && (
                <button type="button" className="primary" onClick={() => setNewFileOpen(true)}>New file</button>
              )}
              {!filesOpen && (
                <button type="button" className="bar-button" onClick={() => togglePanel('files')}>Show files</button>
              )}
            </div>
          )}
        </main>

        {commentsOpen && (
          <CommentsPanel
            path={path}
            comments={comments}
            pendingAnchor={pendingAnchor}
            pendingTarget={pendingTarget}
            onSave={saveComment}
            onCancel={() => { setPendingAnchor(null); setPendingTarget(null) }}
            onToggleResolved={toggleResolved}
            onDelete={deleteComment}
          />
        )}
      </div>

      {publishOpen && (
        <PublishDialog
          branch={branch}
          path={path}
          isNew={isNewFile}
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
      {newFileOpen && (
        <NewFileDialog
          defaultFolder={defaultFolder}
          folders={folders}
          onClose={() => setNewFileOpen(false)}
          onCreate={createNewFile}
        />
      )}
      {exportOpen && (
        <ExportDialog
          title={path}
          commentCount={docComments.length}
          onClose={() => setExportOpen(false)}
          onPrint={(includeComments) => {
            try {
              void printHtml(exportHtml(includeComments))
                .then(() => setExportOpen(false))
                .catch((err: Error) => setError(err.message))
            } catch (err) {
              setError((err as Error).message)
            }
          }}
          onDownload={(includeComments) => {
            void exportHtml(includeComments)
              .then((html) => {
                downloadHtml(path.replace(/\.(md|markdown)$/i, ''), html)
                setExportOpen(false)
              })
              .catch((err: Error) => setError(err.message))
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
