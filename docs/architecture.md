# Architecture

## Goal

Edit Markdown in a WYSIWYG editor, keep review notes next to the text they refer to, and turn the
result into a normal git pull request. The repository remains the source of truth: the app writes
no database and keeps no server-side copy of documents.

## Components

| Component | Location | Responsibility |
|---|---|---|
| React client | `src/client/` | Repo/file browsing, TipTap editor, comment composer and panel, publish dialog, PAT dialog |
| API server | `src/server/` | Express JSON API, provider selection, token state |
| Git provider interface | `src/server/providers/types.ts` | `listRepos`, `listMarkdownFiles`, `readFile`, `publish` |
| Local provider | `src/server/providers/local.ts` | Reads working tree, publishes via a temporary git worktree |
| GitHub provider | `src/server/providers/github.ts` | GitHub REST: contents, trees, blobs, commits, refs, PRs |
| Shared models | `src/shared/` | API types and `comments.json` validation/serialization |

## Data flow

```
provider + repo + file ──► GET file ──► Markdown ──► TipTap (Markdown extension)
                        └─► GET comments.json ──► anchors ──► ProseMirror decorations
selection ──► CommentAnchor { quote, prefix, suffix, start, end } ──► comments.json in memory
Publish ──► POST /publish { changed files, comments, branch, commit, PR } ──► git provider ──► branch + PR
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

`src/client/commentHighlight.ts` is a ProseMirror plugin that rebuilds inline decorations whenever
the comment list or document changes.

## Publishing

Both providers produce one branch and one commit containing the changed Markdown files and
`comments.json` (always written, so removing the last comment is also publishable).

- **Local**: create a detached worktree from the base ref in a temp dir, create a new branch there,
  write the files, commit with an explicit identity, push to `origin`, then use `gh pr create` when
  the remote is GitHub. The user's checkout and uncommitted work are never modified; the worktree
  is removed in `finally`.
- **GitHub**: create blobs, a tree based on the base commit's tree, a commit and a ref through the
  REST API, then open a PR. No clone is needed.

`MARGINALIA_DRY_RUN=1` stops the local provider after the commit, for safe testing.

## Auth

GitHub access uses a PAT, not an OAuth app. A token can be pasted in the UI (`POST /api/token`,
validated with `GET /user`), set via `GITHUB_TOKEN`, or read from `MARGINALIA_TOKEN_FILE`. UI tokens
live only in server memory; env/file tokens are the fallback after a UI token. The browser never
receives the token. A future multi-user deployment would need per-user sessions and OAuth instead.

## Security notes

- Repo aliases are resolved only against configured local roots; GitHub repo ids are regex-checked.
- File paths are checked for traversal before any read or write.
- All git/gh invocations use `execFile` with argument arrays, never shell interpolation.
- Branch names are restricted to git-safe characters.
- Local publishing never writes into the user's working tree.

## Possible next steps

- OAuth GitHub App and per-user sessions.
- Diff/conflict detection against the current base ref before publishing.
- Comment replies, notifications, and a filter for resolved comments.
- Multi-file editing with per-file comments in a shared `comments.json`.
- Persisting drafts and comment anchors in a stable sidecar format based on markdown source offsets.
- Rendering comment markers in the Markdown source view as well as in the WYSIWYG view.
