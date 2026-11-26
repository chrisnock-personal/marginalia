# Architecture

## Goal

Edit Markdown in a WYSIWYG editor, keep review notes next to the text they refer to, and turn the
result into a normal git pull request. The repository remains the source of truth: the app writes
no database and keeps no server-side copy of documents.

## Components

| Component | Location | Responsibility |
|---|---|---|
| React client | `src/client/` | Repo/file browsing, TipTap editor, comments panel, asset manager, HTML export, publish and PAT dialogs |
| API server | `src/server/` | Express JSON API, provider selection, token state |
| Git provider interface | `src/server/providers/types.ts` | `listRepos`, `listMarkdownFiles`, `listAssets`, `readFile`, `readAsset`, `headSha`, `publish` |
| Local provider | `src/server/providers/local.ts` | Reads committed content (following `origin`), publishes via a temporary git worktree |
| GitHub provider | `src/server/providers/github.ts` | GitHub REST: contents, trees, blobs, commits, refs, PRs |
| Shared models | `src/shared/` | API types and `comments.json` validation/serialization |
| Desktop main | `src/desktop/main.ts` | Electron window/menu, settings, loopback server, folder picker IPC, encrypted token storage |
| Preload bridge | `src/desktop/preload.ts` | Minimal `contextBridge` API and the per-launch secret; no Node access for the page |

## Desktop app

Electron's main process starts the same `createServer()` with `desktop: true`, `clientDir` pointing
at the packaged React build, a mutable local-roots map and token persistence hooks. It listens on
port `0` at `127.0.0.1`, then loads that origin in a `BrowserWindow`. `settings.json` in user-data
holds the added folders, window bounds and a `safeStorage`-encrypted token. The preload script
exposes only `chooseFolder`, repo add/remove/list, `openExternal` and the launch secret. Git is
preferentially the binary provided by the optional `dugite` dependency, falling back to `git` on
`PATH`; electron-builder unpacks that binary from asar.

## Data flow

```
provider + repo + file ──► GET file ──► Markdown ──► TipTap (StarterKit + TableKit + image)
                        ├─► GET comments.json ──► anchors / image targets ──► decorations
                        ├─► GET head ──► base SHA
                        ├─► GET assets ──► asset manager
                        └─► GET asset ──► repo-relative images for display
selection / image click ──► CommentAnchor or ImageTarget ──► comments.json in memory
paste/drop image ──► base64 FileChange + object-URL preview ──► staged asset
rename/move/delete ──► rewrite Markdown references in every file ──► docEdits + asset FileChanges
Export ──► editor HTML + print CSS ──► new tab → browser Print / Save as PDF
Publish ──► POST /publish { base SHA, files (+ base64/deleted assets), comments, branch, commit, PR }
        ──► conflict check ──► git provider ──► branch + PR
```

## Comment anchoring

TipTap works on a ProseMirror document, but the repository stores Markdown. Anchors are therefore
stored as text-level selectors rather than ProseMirror positions, which would be invalid in a
different editor or after a reload:

- `start`/`end`: offsets into the rendered plain text of the document (a hint, not authoritative).
- `quote`: exact selected text.
- `prefix`/`suffix`: up to 40 characters of surrounding context.

On load, `src/client/anchors.ts` flattens the document while mapping each character back to a
ProseMirror position. `resolveAnchor` tries the stored offsets, then the prefix+quote+suffix
context, then a plain quote search. A comment whose text was deleted stays in the sidebar but
becomes unhighlighted; it is not silently dropped from `comments.json`.

`src/client/commentHighlight.ts` is a ProseMirror plugin that rebuilds decorations whenever the
comment list or document changes. Image comments use an `ImageTarget` (`{ type: 'image', path }`)
instead of a text anchor: the plugin finds image nodes whose `src` resolves to that repo path and
adds a node decoration. Replies carry a `parentId` pointing at a root comment and reuse its anchor
or target; only root comments are highlighted, and resolving or deleting a root applies to its
replies. Renaming an image updates targets in `comments.json`; deleting it removes the comment.

## Publishing

The client records the base ref's commit SHA when it opens a document, reads the page and
`comments.json` at that SHA, and sends the SHA with the publish request. The server compares it with the current head before writing anything; a mismatch returns
`409 CONFLICT` and the UI offers to reload the file. This is deliberately conservative (any commit
to the base branch triggers it) but prevents silently overwriting newer work. A three-way merge is
future work.

Both providers produce one branch and one commit containing the changed Markdown files (including
cross-file reference rewrites), staged/deleted image assets and `comments.json` (always written, so
removing the last comment is also publishable). `FileChange.encoding: 'base64'` marks binary assets:
the local provider decodes before writing and the GitHub provider passes the base64 straight to the
blobs API. `FileChange.delete: true` removes a path: `rm` in the local worktree, `sha: null` in the
GitHub tree API.

- **Local**: `git fetch origin` (no credential prompts, 15 s timeout) and use `origin/<base ref>`
  as the base, falling back to the local ref when there is no reachable origin. Reads by branch
  name follow the same remote-tracking ref, so the editor never shows a stale checkout. Create a
  detached worktree from that base commit in a temp dir, create a new branch there,
  write the files, commit with an explicit identity and push to `origin`. If the remote is GitHub and
  a token is configured, the PR is opened through GitHub's REST API (`POST /repos/:owner/:repo/pulls`);
  `prRepo` can override an unrecognised remote such as a local mirror. No `gh` CLI is needed. The
  user's checkout and uncommitted work are never modified; the worktree is removed in `finally`.
- **GitHub**: create blobs, a tree based on the base commit's tree, a commit and a ref through the
  REST API, then open a PR. No clone is needed.

`MARGINALIA_DRY_RUN=1` stops the local provider after the commit, for safe testing.

## Rich Markdown

`@tiptap/markdown` only round-trips constructs that have a registered Tiptap node, so the editor
registers `TableKit` (GFM tables with row/column commands) and a customised `Image` node alongside
`StarterKit`. Images keep their Markdown `src` (absolute URL or path relative to the document);
`src/client/repoImage.ts` only rewrites the rendered `<img src>` so repo-relative images load via
`GET /repos/:provider/:repo/asset`. Images pasted, dropped or chosen from disk are read as base64,
staged in `assets/` beside the document with a generated filename, inserted into the editor and
previewed from an object URL until publish. Reordering an image is just moving its Markdown node.

The **Assets** dialog lists images from the base ref plus images staged in this session. Renaming or
moving reads the bytes from `GET /asset` (or from the staged base64), writes a new `FileChange` at
the destination, marks the old path for deletion when it exists in the base, and rewrites all
Markdown references via `src/client/assetPaths.ts`. Inline links, images, reference definitions and
raw `<img>` tags are supported; deletion removes image embeds and turns links into plain text. The
rewritten Markdown for other files is held in `docEdits` and published with the current document.

`src/client/export.ts` builds a standalone HTML document from `editor.getHTML()`, with absolute
image URLs and print CSS, including an optional comments appendix. The UI opens it in a new tab and
calls `print()` so the user can choose **Save as PDF**; the same HTML can be downloaded directly.

## Auth

GitHub access supports PAT, OAuth App and device-flow sign-in.

- PAT: pasted in the UI (`POST /api/token`, validated with `GET /user`), set via `GITHUB_TOKEN`, or
  read from `MARGINALIA_TOKEN_FILE`.
- OAuth: `GET /api/auth/github/url` issues a single-use state value (10-minute expiry) and returns
  the GitHub authorize URL; the callback exchanges the code for a token, validates it with
  `GET /user`, stores it server-side and redirects to the UI.
- Device flow (desktop): `POST /api/auth/github/device` returns a user code and verification URL;
  `POST /api/auth/github/device/poll` waits for GitHub and installs the token. Only a public client
  id is needed; no redirect URI or client secret.

UI/OAuth tokens live only in server memory for the web app. In the desktop app the main process
encrypts every token change with Electron `safeStorage` into `settings.json` in user-data; if no
system credential store is available the token stays in memory only. The browser/renderer never
receives a token. This is still a single-user/single-identity model; a multi-user deployment would
need per-user sessions and scoped tokens.

## Security notes

- Repo aliases are resolved only against configured local roots; GitHub repo ids are regex-checked.
- File paths are checked for traversal before any read or write, including asset reads.
- Assets are served with an explicit content type and `Cache-Control: no-store`.
- All git invocations use `execFile` with argument arrays, never shell interpolation.
- Branch names are restricted to git-safe characters.
- Local publishing never writes into the user's working tree.
- The Electron server binds only `127.0.0.1` to a random port and requires a per-launch secret on
  `/api`; the renderer has `nodeIntegration` off, `contextIsolation` on, and only the preload bridge.
  External links and new windows are opened with `shell.openExternal`, never in the app window.

## Possible next steps

- Per-user sessions and scoped tokens for a multi-user deployment.
- File-level three-way merges instead of branch-level conflict detection.
- Notifications and a filter for resolved comments.
- Server-side HTML/PDF export from stored Markdown, with deterministic pagination.
- Multi-file editing with per-file comments and an asset manager for non-image files.
- Path-based comment anchors for non-text nodes other than images.
- Persisting drafts and comment anchors in a stable sidecar format based on markdown source offsets.
- Rendering comment markers in the Markdown source view as well as in the WYSIWYG view.
