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
    mkdirSync(join(repo, 'docs', 'assets'), { recursive: true })
    git(['init', '--bare', '--initial-branch=main'], remote)
    git(['init', '--initial-branch=main'], repo)
    git(['config', 'user.name', 'Test'], repo)
    git(['config', 'user.email', 'test@localhost'], repo)
    writeFileSync(join(repo, 'README.md'), '# Test repo\n')
    writeFileSync(join(repo, 'docs', 'guide.md'), '# Guide\n\n![Demo](assets/old.png)\n')
    writeFileSync(join(repo, 'docs', 'assets', 'old.png'), Buffer.from('89504e470d0a1a0a', 'hex'))
    git(['add', '.'], repo)
    git(['commit', '-m', 'initial'], repo)
    git(['remote', 'add', 'origin', remote], repo)

    const provider = new LocalGitProvider(new Map([['test', repo]]))
    assert.equal((await provider.listRepos())[0]?.defaultBranch, 'main')
    assert.equal(await provider.headSha('test', 'main'), git(['rev-parse', 'HEAD'], repo))
    assert.ok((await provider.listMarkdownFiles('test')).some((f) => f.path === 'docs/guide.md'))
    assert.match((await provider.readFile('test', 'docs/guide.md')) ?? '', /assets\/old\.png/)
    assert.deepEqual((await provider.listAssets('test')).map((asset) => asset.path), ['docs/assets/old.png'])
    assert.equal(await provider.readAsset('test', 'docs/assets/missing.png'), null)

    const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex')
    const result = await provider.publish({
      provider: 'local',
      repo: 'test',
      branch: 'marginalia/test-edit',
      commitMessage: 'Edit guide',
      files: [
        { path: 'docs/guide.md', content: '# Guide\n\nChanged text.\n\n![Demo](assets/pic.png)\n' },
        { path: 'docs/assets/pic.png', content: png.toString('base64'), encoding: 'base64' },
        { path: 'docs/assets/old.png', content: '', delete: true },
      ],
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
          {
            id: 'c_image',
            path: 'docs/guide.md',
            target: { type: 'image', path: 'docs/assets/pic.png' },
            body: 'Is this the right image?',
            author: 'Chris',
            createdAt: '2026-11-25T10:00:00.000Z',
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
    const publishedPng = execFileSync('git', ['show', 'marginalia/test-edit:docs/assets/pic.png'], {
      cwd: remote,
      encoding: 'buffer',
    })
    assert.equal(Buffer.compare(publishedPng, png), 0, 'base64 asset must be written byte-for-byte')
    assert.equal(
      Buffer.compare((await provider.readAsset('test', 'docs/assets/pic.png', 'marginalia/test-edit')) ?? Buffer.alloc(0), png),
      0,
    )
    assert.throws(
      () => git(['cat-file', '-e', 'marginalia/test-edit:docs/assets/old.png'], remote),
      'deleted asset must not exist in the published branch',
    )
    const comments = JSON.parse(git(['show', 'marginalia/test-edit:comments.json'], remote))
    assert.equal(comments.comments[0].body, 'Check this sentence')
    assert.equal(comments.comments[1].target.path, 'docs/assets/pic.png')
    assert.match(readFileSync(join(repo, 'docs', 'guide.md'), 'utf8'), /assets\/old\.png/)
    assert.equal(git(['status', '--porcelain'], repo), '')
    assert.equal(git(['worktree', 'list'], repo).split('\n').length, 1)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
