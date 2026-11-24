# API reference

Base URL: `/api` (same origin; Vite proxies to the Express server in development).

All responses are JSON. Errors have the shape `{ "error": "message" }` with an appropriate HTTP
status.

## `GET /config`

Returns the available sources and whether each is configured.

```json
{
  "providers": [
    { "id": "local", "label": "Local git repos", "configured": true, "detail": "2 repo(s) configured", "dryRun": false },
    { "id": "github", "label": "GitHub (PAT)", "configured": true, "detail": "Authenticated as chrisnock" }
  ]
}
```

## `POST /token`

Validate and install a GitHub PAT in server memory.

```json
{ "token": "github_pat_..." }
```

Returns `{ "configured": true, "login": "chrisnock" }`. `401`/`422` errors indicate a bad token.

## `DELETE /token`

Clear a UI-supplied token. Returns `{ "configured": boolean }` (still true if an env/file token is
present).

## `GET /repos?provider=local|github`

List repositories for that provider. Local entries use the directory name as `id`; GitHub entries
use `owner/name`.

```json
[
  { "provider": "local", "id": "articles", "fullName": "articles", "defaultBranch": "main" }
]
```

If `provider` is omitted, the first configured provider is used.

## `GET /repos/:provider/:repo/files?ref=<optional>`

List Markdown files (`.md`, `.markdown`) in the repo at `ref`, or the default branch/`HEAD`.

```json
[{ "path": "docs/guide.md", "type": "blob" }]
```

## `GET /repos/:provider/:repo/file?path=<path>&ref=<optional>`

Read a file. Returns `{ "path": "docs/guide.md", "content": "# Guide\n..." }`; `404` if absent.

## `POST /publish`

Create a branch, commit and PR.

```json
{
  "provider": "local",
  "repo": "articles",
  "baseRef": "main",
  "branch": "marginalia/guide-m1abc",
  "commitMessage": "Edit guide.md",
  "files": [{ "path": "docs/guide.md", "content": "# Updated guide\n" }],
  "comments": {
    "version": 1,
    "comments": []
  },
  "pr": { "title": "Docs: update guide", "body": "With inline comments in comments.json" }
}
```

`files` may be empty when only comments changed. `commentsPath` defaults to `comments.json`.
`pr` is optional; without it the branch is pushed but no PR is opened.

```json
{
  "branch": "marginalia/guide-m1abc",
  "commit": "a1b2c3d",
  "pushed": true,
  "prUrl": "https://github.com/owner/repo/pull/12",
  "notes": []
}
```
