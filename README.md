# Marginalia

A WYSIWYG Markdown editor for git repositories. Open a Markdown file from a local repo or from
GitHub, edit it richly, leave comments anchored to selected text, and publish the edits plus a
sidecar `comments.json` as a pull request.

## Features

- TipTap/ProseMirror WYSIWYG editing with bidirectional Markdown (`@tiptap/markdown`).
- Two git sources: configured local repositories (git CLI) and GitHub (REST API).
- Inline comments anchored to text, with threaded replies, stored in a separate `comments.json` in the PR.
- Publishing creates a branch, one commit and optionally a PR — without touching your checkout.
- Base-branch conflict detection: publishing fails if the base moved after the file was opened.
- GitHub authentication with a PAT or a GitHub OAuth App (both held server-side only).

## Quick start

```bash
npm install
# Local repos, colon-separated absolute paths; aliases are the directory names:
MARGINALIA_LOCAL_REPOS="$HOME/local-repos/articles:$HOME/local-repos/project-overviews" npm run dev
```

Open <http://127.0.0.1:5173>. The Vite dev server proxies `/api` to the API on port 5174.
`npm run build && npm start` serves the built client and API together on 5174.

### GitHub PAT

Click **GitHub sign-in** in the header to use an OAuth App or paste a PAT. Tokens are validated
with `GET /user` and kept only in the server process — never written to browser storage or disk.
Classic PATs need `repo` for private repos (`public_repo` is enough for public ones); fine-grained
tokens need read access to contents and write access to contents, metadata and PRs.

To use OAuth, register a GitHub OAuth App with callback URL
`http://127.0.0.1:5174/api/auth/github/callback` and start the server with
`GITHUB_CLIENT_ID=... GITHUB_CLIENT_SECRET=...`; set `MARGINALIA_OAUTH_REDIRECT_URI` if the
callback URL differs, and `MARGINALIA_PUBLIC_URL` to the browser-facing origin (default
`http://127.0.0.1:5173`) so the callback can redirect back to the UI. The state parameter is
single-use and expires after 10 minutes.

For headless use, provide a PAT at startup instead:

```bash
GITHUB_TOKEN=github_pat_... npm run dev
# or
MARGINALIA_TOKEN_FILE="$HOME/.config/marginalia/github-token" npm run dev
```

The env/file token is the fallback after a UI token; **Clear token** removes only the UI token.

### Other configuration

| Variable | Default | Purpose |
|---|---|---|
| `MARGINALIA_LOCAL_REPOS` | unset | Colon-separated absolute paths to git repos |
| `GITHUB_TOKEN` | unset | GitHub PAT fallback |
| `MARGINALIA_TOKEN_FILE` | unset | File containing a PAT, read at startup |
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` | unset | GitHub OAuth App credentials (enables OAuth sign-in) |
| `MARGINALIA_OAUTH_REDIRECT_URI` | `http://127.0.0.1:5174/api/auth/github/callback` | Registered OAuth callback |
| `MARGINALIA_PUBLIC_URL` | `http://127.0.0.1:5173` | Browser origin the OAuth callback redirects to |
| `MARGINALIA_DRY_RUN` | `0` | `1` commits to a temp worktree but never pushes/opens a PR |
| `PORT` | `5174` | API port (and the combined production server port) |

## Workflow

1. Choose a provider, repo and `.md` file.
2. Select text, click **+ Comment**, and write the note. Use **Reply** to continue a thread.
3. Click **Publish PR**, check the branch/commit/PR details, and publish.
4. If the base branch moved in the meantime, publishing returns a conflict prompt and offers a reload.
5. The PR contains the edited Markdown (if changed) and `comments.json`.

Example `comments.json`:

```json
{
  "version": 1,
  "comments": [
    {
      "id": "c_m0abc_xyz123",
      "path": "docs/guide.md",
      "anchor": {
        "quote": "click the green button",
        "prefix": "When you ",
        "suffix": " to continue",
        "start": 412,
        "end": 433
      },
      "body": "The button is blue in the current UI.",
      "author": "Chris",
      "createdAt": "2026-11-24T10:00:00.000Z",
      "resolved": false
    }
  ]
}
```

Anchors record offsets into the editor's rendered plain text plus prefix/suffix context; the UI
re-finds the quote by offset hint, then context, then text search, so comments survive small edits.
Replies reuse their parent's anchor and add `"parentId": "<root comment id>"`.

## Development

```bash
npm run typecheck
npm test
npm run build
```

Design notes: [docs/architecture.md](docs/architecture.md). API reference: [docs/api.md](docs/api.md).

## Current limits

Prototype scope: single-user, single-document editing at a time; one GitHub identity per server
process (no per-user sessions). Conflict detection is branch-level, not three-way file merges.
Comments highlight in the editor but are not posted as GitHub review comments. Only Markdown files
are browsed; images and other assets must already exist in the target branch.
