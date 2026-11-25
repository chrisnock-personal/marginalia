# API reference

Base URL: `/api` (same origin; Vite proxies to the Express server in development).

All responses are JSON. Errors have the shape `{ "error": "message" }` with an appropriate HTTP
status. When `MARGINALIA_API_SECRET` is set, every request must supply it in the
`X-Marginalia-Api-Secret` header (or as `?secret=…` for URLs such as images that cannot set headers).
The Electron app generates a random secret per launch and passes it to the page through its preload
script.

## `GET /config`

Returns the available sources and whether each is configured.

```json
{
  "desktop": false,
  "localRepos": [],
  "providers": [
    { "id": "local", "label": "Local git repos", "configured": true, "detail": "2 repo(s) configured", "dryRun": false },
    { "id": "github", "label": "GitHub (PAT)", "configured": true, "detail": "Authenticated as chrisnock", "oauthConfigured": true, "deviceFlowConfigured": false }
  ]
}
```

`desktop` and `localRepos` are present for the Electron app; `deviceFlowConfigured` is true when a
public GitHub client id is available for device sign-in.

## `POST /token`

Validate and install a GitHub PAT in server memory.

```json
{ "token": "github_pat_..." }
```

Returns `{ "configured": true, "login": "chrisnock" }`. `401`/`422` errors indicate a bad token.

## `DELETE /token`

Clear a UI-supplied token. Returns `{ "configured": boolean }` (still true if an env/file token is
present).

## `GET /auth/github/url`

Requires `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET`. Returns a GitHub authorize URL containing a
single-use `state` value (valid for 10 minutes).

```json
{ "url": "https://github.com/login/oauth/authorize?client_id=…&state=…" }
```

## `GET /auth/github/callback?code=…&state=…`

OAuth callback. Exchanges the code, validates the token, stores it server-side and redirects to
`MARGINALIA_PUBLIC_URL/?auth=success` (or `?auth=error&message=…`).

## `POST /auth/github/device`

Requires `MARGINALIA_GITHUB_CLIENT_ID` (or `GITHUB_CLIENT_ID`). Asks GitHub for a device code.

```json
{
  "deviceCode": "…",
  "userCode": "ABCD-1234",
  "verificationUri": "https://github.com/login/device",
  "expiresIn": 900,
  "interval": 5
}
```

## `POST /auth/github/device/poll`

Body: `{ "deviceCode": "…" }`. Returns `{ "pending": true, "slowDown": boolean }` while the user has
not finished, or `{ "pending": false, "configured": true, "login": "chrisnock" }` once authorized.
The desktop app persists the token through Electron `safeStorage` when it changes.

## `GET /repos?provider=local|github`

List repositories for that provider. Local entries use the directory name as `id`; GitHub entries
use `owner/name`.

```json
[
  { "provider": "local", "id": "articles", "fullName": "articles", "defaultBranch": "main" }
]
```

If `provider` is omitted, the first configured provider is used.

## `GET /repos/:provider/:repo/head?ref=<optional>`

Returns the commit SHA at the tip of `ref` (default branch/`HEAD`). For a local repo with an
`origin`, this fetches first and returns `origin/<ref>`.

```json
{ "sha": "a1b2c3d..." }
```

## `GET /repos/:provider/:repo/files?ref=<optional>`

List Markdown files (`.md`, `.markdown`) in the repo at `ref`, or the default branch/`HEAD`.

```json
[{ "path": "docs/guide.md", "type": "blob" }]
```

## `GET /repos/:provider/:repo/file?path=<path>&ref=<optional>`

Read a file. Returns `{ "path": "docs/guide.md", "content": "# Guide\n..." }`; `404` if absent.

## `GET /repos/:provider/:repo/asset?path=<path>&ref=<optional>`

Return the raw bytes of a repo asset (images) with an appropriate `Content-Type`. `404` if absent.
Used by the editor to display repo-relative Markdown images.

## `GET /repos/:provider/:repo/assets?ref=<optional>`

List image files in the repo (`png`, `jpg`, `gif`, `webp`, `svg`, `avif`, `bmp`, `ico`).

```json
[{ "path": "docs/assets/pic.png", "type": "blob" }]
```

## `POST /publish`

Create a branch, commit and PR.

```json
{
  "provider": "local",
  "repo": "articles",
  "baseRef": "main",
  "baseSha": "a1b2c3d...",
  "branch": "marginalia/guide-m1abc",
  "commitMessage": "Edit guide.md",
  "files": [
    { "path": "docs/guide.md", "content": "# Updated guide\n" },
    { "path": "docs/assets/pic.png", "content": "iVBORw0KGg==", "encoding": "base64" },
    { "path": "docs/assets/old.png", "content": "", "delete": true }
  ],
  "comments": {
    "version": 1,
    "comments": []
  },
  "pr": { "title": "Docs: update guide", "body": "With inline comments in comments.json" }
}
```

`files` may be empty when only comments changed; `encoding` defaults to `utf8`, while `base64` is
for binary assets such as pasted images. `"delete": true` removes a path in the published branch
(the GitHub provider sends a tree entry with `sha: null`). `baseSha` is optional; when supplied and
different from the current head, the request fails with `409` and `{ "error": "Base branch changed
…" }`. Comments carry either a text `anchor` or an image `target`:
`{ "type": "image", "path": "docs/assets/pic.png" }`. Replies add `"parentId": "<root comment id>"`.
`commentsPath` defaults to `comments.json`. `pr` is optional; without it the branch is pushed but
no PR is opened.

```json
{
  "branch": "marginalia/guide-m1abc",
  "commit": "a1b2c3d",
  "pushed": true,
  "prUrl": "https://github.com/owner/repo/pull/12",
  "notes": []
}
```
