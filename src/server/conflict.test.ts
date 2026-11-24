import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import type { Server } from 'node:http'
import { createServer } from './index'

function git(args: string[], cwd: string): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

test('publish rejects a stale base SHA and accepts the current one', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'marginalia-conflict-'))
  const previousLocal = process.env.MARGINALIA_LOCAL_REPOS
  const previousPort = process.env.PORT
  let server: Server | undefined

  try {
    const remote = join(dir, 'remote.git')
    const repo = join(dir, 'repo')
    mkdirSync(remote)
    mkdirSync(repo)
    git(['init', '--bare', '--initial-branch=main'], remote)
    git(['init', '--initial-branch=main'], repo)
    git(['config', 'user.name', 'Test'], repo)
    git(['config', 'user.email', 'test@localhost'], repo)
    writeFileSync(join(repo, 'guide.md'), '# Guide\n')
    git(['add', '.'], repo)
    git(['commit', '-m', 'initial'], repo)
    git(['remote', 'add', 'origin', remote], repo)

    process.env.MARGINALIA_LOCAL_REPOS = repo
    process.env.PORT = '0'
    const { app } = createServer()
    server = app.listen(0)
    await new Promise<void>((resolve) => server!.once('listening', resolve))
    const address = server.address()
    assert.ok(address && typeof address !== 'string')
    const base = `http://127.0.0.1:${address.port}`

    const head = (await (await fetch(`${base}/api/repos/local/repo/head`)).json()) as { sha: string }
    assert.equal(head.sha, git(['rev-parse', 'HEAD'], repo))

    const request = {
      provider: 'local',
      repo: 'repo',
      baseSha: 'stale-sha',
      branch: 'marginalia/conflict-test',
      commitMessage: 'Edit guide',
      files: [{ path: 'guide.md', content: '# Updated guide\n' }],
      comments: { version: 1, comments: [] },
      pr: { title: 'Update', body: '' },
    }
    const post = (baseSha: string) =>
      fetch(`${base}/api/publish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...request, baseSha }),
      })

    const stale = await post('stale-sha')
    assert.equal(stale.status, 409)
    assert.match(((await stale.json()) as { error: string }).error, /Base branch changed/)

    const fresh = await post(head.sha)
    assert.equal(fresh.status, 200)
    assert.match(git(['show', 'marginalia/conflict-test:guide.md'], remote), /Updated guide/)
  } finally {
    await new Promise<void>((resolve) => server?.close(() => resolve()))
    if (previousLocal === undefined) delete process.env.MARGINALIA_LOCAL_REPOS
    else process.env.MARGINALIA_LOCAL_REPOS = previousLocal
    if (previousPort === undefined) delete process.env.PORT
    else process.env.PORT = previousPort
    rmSync(dir, { recursive: true, force: true })
  }
})
