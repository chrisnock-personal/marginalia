import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { LocalGitProvider } from './local'

function git(args: string[], cwd: string): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

test('local provider reads files and publishes a branch with comments.json', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'marginalia-test-'))
  try {
    const remote = join(dir, 'remote.git')
    const repo = join(dir, 'repo')
    mkdirSync(remote)
    mkdirSync(join(repo, 'docs'), { recursive: true })
    git(['init', '--bare', '--initial-branch=main'], remote)
    git(['init', '--initial-branch=main'], repo)
    git(['config', 'user.name', 'Test'], repo)
    git(['config', 'user.email', 'test@localhost'], repo)
    writeFileSync(join(repo, 'README.md'), '# Test repo\n')
    writeFileSync(join(repo, 'docs', 'guide.md'), '# Guide\n\nOriginal text.\n')
    git(['add', '.'], repo)
    git(['commit', '-m', 'initial'], repo)
    git(['remote', 'add', 'origin', remote], repo)

    const provider = new LocalGitProvider(new Map([['test', repo]]))
    assert.equal((await provider.listRepos())[0]?.defaultBranch, 'main')
    assert.equal(await provider.headSha('test', 'main'), git(['rev-parse', 'HEAD'], repo))
    assert.ok((await provider.listMarkdownFiles('test')).some((f) => f.path === 'docs/guide.md'))
    assert.match((await provider.readFile('test', 'docs/guide.md')) ?? '', /Original text/)

    const result = await provider.publish({
      provider: 'local',
      repo: 'test',
      branch: 'marginalia/test-edit',
      commitMessage: 'Edit guide',
      files: [{ path: 'docs/guide.md', content: '# Guide\n\nChanged text.\n' }],
      comments: {
        version: 1,
        comments: [
          {
            id: 'c_test',
            path: 'docs/guide.md',
            anchor: { quote: 'Changed text', prefix: '', suffix: '.', start: 10, end: 22 },
            body: 'Check this sentence',
            author: 'Chris',
            createdAt: '2026-11-24T10:00:00.000Z',
            resolved: false,
          },
        ],
      },
      pr: { title: 'Update guide', body: 'With comments' },
    })

    assert.equal(result.pushed, true)
    assert.equal(result.prUrl, undefined)
    assert.match(result.notes.join(' '), /not GitHub/)
    assert.match(git(['show', 'marginalia/test-edit:docs/guide.md'], remote), /Changed text/)
    const comments = JSON.parse(git(['show', 'marginalia/test-edit:comments.json'], remote))
    assert.equal(comments.comments[0].body, 'Check this sentence')
    assert.match(readFileSync(join(repo, 'docs', 'guide.md'), 'utf8'), /Original text/)
    assert.equal(git(['status', '--porcelain'], repo), '')
    assert.equal(git(['worktree', 'list'], repo).split('\n').length, 1)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
