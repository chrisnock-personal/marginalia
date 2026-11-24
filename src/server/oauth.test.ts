import assert from 'node:assert/strict'
import { test } from 'node:test'
import { authorizeUrl, exchangeCode, OAuthState } from './oauth'

test('OAuth state is single-use and expires', () => {
  const states = new OAuthState()
  const state = states.issue()
  assert.match(state, /^[0-9a-f]{48}$/)
  assert.equal(states.consume(state), true)
  assert.equal(states.consume(state), false)
  assert.equal(states.consume('unknown'), false)

  const short = new OAuthState()
  const expiring = short.issue()
  const originalNow = Date.now
  Date.now = () => originalNow() + 11 * 60 * 1000
  try {
    assert.equal(short.consume(expiring), false)
  } finally {
    Date.now = originalNow
  }
})

test('authorize URL carries client, redirect, scope and state', () => {
  const url = new URL(
    authorizeUrl(
      {
        clientId: 'client-123',
        clientSecret: 'secret',
        redirectUri: 'http://127.0.0.1:5174/api/auth/github/callback',
      },
      'state-abc',
    ),
  )
  assert.equal(url.origin + url.pathname, 'https://github.com/login/oauth/authorize')
  assert.equal(url.searchParams.get('client_id'), 'client-123')
  assert.equal(url.searchParams.get('state'), 'state-abc')
  assert.equal(url.searchParams.get('scope'), 'repo,read:user')
})

test('code exchange posts the client secret and returns the token', async () => {
  let seen: { url: string; body: string; accept: string | null } | undefined
  const fakeFetch: typeof fetch = async (input, init = {}) => {
    seen = {
      url: String(input),
      body: init.body as string,
      accept: new Headers(init.headers).get('Accept'),
    }
    return new Response(JSON.stringify({ access_token: 'oauth-token' }), { status: 200 })
  }
  const token = await exchangeCode(
    { clientId: 'client-123', clientSecret: 'secret', redirectUri: 'http://localhost/cb' },
    'code-xyz',
    fakeFetch,
  )
  assert.equal(token, 'oauth-token')
  assert.equal(seen?.url, 'https://github.com/login/oauth/access_token')
  assert.equal(seen?.accept, 'application/json')
  assert.equal(JSON.parse(seen!.body).code, 'code-xyz')
  assert.equal(JSON.parse(seen!.body).client_secret, 'secret')
})
