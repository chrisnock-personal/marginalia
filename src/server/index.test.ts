import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createServer } from './index'

test('the API secret blocks unauthenticated local requests', async () => {
  const { app } = createServer({
    apiSecret: 'per-launch-secret',
    desktop: true,
    localRoots: new Map([['docs', '/tmp/docs']]),
    deviceFlow: { clientId: 'desktop-client' },
    initialToken: '',
  })
  const listener = app.listen(0, '127.0.0.1')
  await new Promise<void>((resolve) => listener.once('listening', resolve))
  const port = (listener.address() as { port: number }).port
  try {
    const denied = await fetch(`http://127.0.0.1:${port}/api/config`)
    assert.equal(denied.status, 401)

    const wrong = await fetch(`http://127.0.0.1:${port}/api/config`, {
      headers: { 'X-Marginalia-Api-Secret': 'nope' },
    })
    assert.equal(wrong.status, 401)

    const allowed = await fetch(`http://127.0.0.1:${port}/api/config`, {
      headers: { 'X-Marginalia-Api-Secret': 'per-launch-secret' },
    })
    assert.equal(allowed.status, 200)
    const config = await allowed.json() as {
      desktop: boolean
      localRepos: Array<{ id: string }>
      providers: Array<{ deviceFlowConfigured?: boolean }>
    }
    assert.equal(config.desktop, true)
    assert.deepEqual(config.localRepos.map((repo) => repo.id), ['docs'])
    assert.equal(config.providers.find((p) => p.deviceFlowConfigured)?.deviceFlowConfigured, true)

    // Image URLs cannot carry a header, so the same secret is accepted in a query.
    const byQuery = await fetch(
      `http://127.0.0.1:${port}/api/config?secret=per-launch-secret`,
    )
    assert.equal(byQuery.status, 200)
  } finally {
    await new Promise<void>((resolve) => listener.close(() => resolve()))
  }
})
