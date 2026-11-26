import assert from 'node:assert/strict'
import { test } from 'node:test'
import { gitHubPullRequest, githubRepoFromRemote, GitHubProvider } from './github'

interface Call {
  url: string
  headers: Headers
  body?: string
}

function fakeFetch(calls: Call[]): typeof fetch {
  return async (input, init = {}) => {
    const url = String(input)
    const headers = new Headers(init.headers)
    calls.push({ url, headers, body: init.body as string | undefined })

    const json = (value: unknown) => new Response(JSON.stringify(value), { status: 200 })
    if (url.endsWith('/user')) return json({ login: 'tester' })
    if (url.endsWith('/repos/o/r')) return json({ default_branch: 'main' })
    if (url.includes('/git/ref/heads/')) return json({ object: { sha: 'base-sha' } })
    if (url.includes('/git/commits/base-sha')) return json({ sha: 'base-sha', tree: { sha: 'base-tree' } })
    if (url.includes('/git/trees/main?recursive=1')) return json({ tree: [
      { path: 'docs/guide.md', type: 'blob' },
      { path: 'docs/assets/pic.png', type: 'blob' },
      { path: 'docs/assets/old.png', type: 'blob' },
    ] })
    if (url.includes('/contents/docs/guide.md')) return new Response('# Guide', { status: 200 })
    if (url.includes('/contents/docs/assets/pic.png')) return new Response(new Uint8Array([137, 80, 78, 71]), { status: 200 })
    if (url.endsWith('/git/blobs')) return json({ sha: `blob-${calls.length}` })
    if (url.endsWith('/git/trees')) return json({ sha: 'new-tree' })
    if (url.endsWith('/git/commits')) return json({ sha: 'new-commit' })
    if (url.endsWith('/git/refs')) return json({})
    if (url.endsWith('/pulls')) return json({ html_url: 'https://github.com/o/r/pull/1' })
    return new Response('not found', { status: 404 })
  }
}

test('GitHub provider publishes a file that is not in the base tree', async () => {
  const calls: Call[] = []
  const provider = new GitHubProvider(() => 'test-pat', fakeFetch(calls))
  await provider.publish({
    provider: 'github',
    repo: 'o/r',
    branch: 'marginalia/new-file',
    commitMessage: 'Add new page',
    files: [{ path: 'docs/new-page.md', content: '# New page\n' }],
    comments: { version: 1, comments: [] },
  })

  const blobs = calls.filter((call) => call.url.endsWith('/git/blobs'))
  assert.equal(blobs.length, 2, 'new Markdown and comments.json')
  assert.equal(JSON.parse(blobs[0].body!).content, Buffer.from('# New page\n').toString('base64'))
  const treeBody = JSON.parse(calls.find((call) => call.url.endsWith('/git/trees'))!.body!)
  const entry = treeBody.tree.find((row: { path: string }) => row.path === 'docs/new-page.md')
  assert.equal(entry?.type, 'blob')
  assert.match(entry?.sha ?? '', /^blob-/)
})

test('GitHub provider sends the PAT and builds a commit and PR', async () => {
  const calls: Call[] = []
  const provider = new GitHubProvider(() => 'test-pat', fakeFetch(calls))

  assert.deepEqual(await provider.whoAmI(), { login: 'tester' })
  assert.equal((await provider.listMarkdownFiles('o/r'))[0]?.path, 'docs/guide.md')
  assert.deepEqual((await provider.listAssets('o/r')).map((asset) => asset.path), [
    'docs/assets/pic.png',
    'docs/assets/old.png',
  ])
  assert.equal(await provider.readFile('o/r', 'docs/guide.md'), '# Guide')
  assert.equal(await provider.headSha('o/r'), 'base-sha')
  assert.deepEqual([...(await provider.readAsset('o/r', 'docs/assets/pic.png')) ?? []], [137, 80, 78, 71])

  const result = await provider.publish({
    provider: 'github',
    repo: 'o/r',
    branch: 'marginalia/guide',
    commitMessage: 'Edit guide',
    files: [
      { path: 'docs/guide.md', content: '# Guide\n\nNew text.\n' },
      { path: 'docs/assets/pic.png', content: 'iVBORw0KGg==', encoding: 'base64' },
      { path: 'docs/assets/old.png', content: '', delete: true },
    ],
    comments: { version: 1, comments: [] },
    pr: { title: 'Update guide', body: 'With comments' },
  })

  assert.equal(result.prUrl, 'https://github.com/o/r/pull/1')
  assert.equal(result.commit, 'new-commit')
  assert.ok(calls.every((call) => call.headers.get('Authorization') === 'Bearer test-pat'))
  const pr = calls.find((call) => call.url.endsWith('/pulls'))
  assert.deepEqual(JSON.parse(pr!.body!), {
    title: 'Update guide',
    body: 'With comments',
    head: 'marginalia/guide',
    base: 'main',
  })
  const blobs = calls.filter((call) => call.url.endsWith('/git/blobs'))
  assert.equal(blobs.length, 3, 'markdown, binary asset and comments.json')
  const assetBlob = blobs[1]
  assert.equal(JSON.parse(assetBlob.body!).encoding, 'base64')
  assert.equal(JSON.parse(assetBlob.body!).content, 'iVBORw0KGg==', 'base64 assets are not re-encoded')
  const treeBody = JSON.parse(calls.find((call) => call.url.endsWith('/git/trees'))!.body!)
  assert.deepEqual(
    treeBody.tree.find((entry: { path: string }) => entry.path === 'docs/assets/old.png'),
    { path: 'docs/assets/old.png', mode: '100644', type: 'blob', sha: null },
    'deletions are sent to the GitHub tree API with a null sha',
  )
})

test('GitHub remotes resolve to owner/name in all common URL forms', () => {
  assert.equal(githubRepoFromRemote('https://github.com/chrisnock/marginalia.git'), 'chrisnock/marginalia')
  assert.equal(githubRepoFromRemote('git@github.com:chrisnock/marginalia.git'), 'chrisnock/marginalia')
  assert.equal(githubRepoFromRemote('ssh://git@github.com/chrisnock/marginalia'), 'chrisnock/marginalia')
  assert.equal(githubRepoFromRemote('/home/chris/local-repos/marginalia'), null)
})

test('a PR can be opened through the API without the gh CLI', async () => {
  const calls: Call[] = []
  const url = await gitHubPullRequest({
    repo: 'o/r',
    head: 'marginalia/docs',
    base: 'main',
    title: 'Docs',
    body: 'From the desktop app',
    token: 'device-token',
    fetchImpl: fakeFetch(calls),
  })
  assert.equal(url, 'https://github.com/o/r/pull/1')
  const pr = calls.find((call) => call.url.endsWith('/pulls'))
  assert.equal(pr?.headers.get('Authorization'), 'Bearer device-token')
  assert.deepEqual(JSON.parse(pr!.body!), {
    title: 'Docs',
    body: 'From the desktop app',
    head: 'marginalia/docs',
    base: 'main',
  })
})
