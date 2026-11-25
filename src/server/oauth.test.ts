import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  authorizeUrl,
  exchangeCode,
  OAuthState,
  pollDeviceCode,
  requestDeviceCode,
} from './oauth'

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

function fakeDeviceFetch(responses: unknown[]): typeof fetch {
  let index = 0
  return async () => new Response(JSON.stringify(responses[index++]), { status: 200 })
}

test('device flow requests a user code', async () => {
  const calls: Array<{ url: string; body: string }> = []
  const fetchImpl = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    calls.push({ url: String(input), body: String(init?.body ?? '') })
    return new Response(JSON.stringify({
      device_code: 'device-1',
      user_code: 'ABCD-1234',
      verification_uri: 'https://github.com/login/device',
      expires_in: 900,
      interval: 5,
    }), { status: 200 })
  }
  const code = await requestDeviceCode({ clientId: 'desktop-client' }, fetchImpl as typeof fetch)
  assert.equal(code.user_code, 'ABCD-1234')
  assert.match(calls[0].url, /login\/device\/code$/)
  assert.equal(JSON.parse(calls[0].body).client_id, 'desktop-client')
})

test('device polling distinguishes pending, slow down and success', async () => {
  const fetchImpl = fakeDeviceFetch([
    { error: 'authorization_pending' },
    { error: 'slow_down' },
    { access_token: 'device-token' },
  ])
  assert.deepEqual(await pollDeviceCode({ clientId: 'c' }, 'device-1', fetchImpl), {
    pending: true,
    slowDown: false,
  })
  assert.deepEqual(await pollDeviceCode({ clientId: 'c' }, 'device-1', fetchImpl), {
    pending: true,
    slowDown: true,
  })
  assert.deepEqual(await pollDeviceCode({ clientId: 'c' }, 'device-1', fetchImpl), {
    pending: false,
    token: 'device-token',
  })
})

test('device polling reports denial as an error', async () => {
  const fetchImpl = fakeDeviceFetch([{ error: 'access_denied', error_description: 'No thanks' }])
  await assert.rejects(
    () => pollDeviceCode({ clientId: 'c' }, 'device-1', fetchImpl),
    /No thanks/,
  )
})
