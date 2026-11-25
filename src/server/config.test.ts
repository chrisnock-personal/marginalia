import assert from 'node:assert/strict'
import { test } from 'node:test'
import { clearGithubToken, setGithubToken, TokenState, type ServerConfig } from './config'

test('clearing a UI token restores the env/file fallback', () => {
  const tokens = new TokenState('env-token')
  tokens.set('ui-token', 'tester')
  assert.equal(tokens.token, 'ui-token')
  tokens.clear()
  assert.equal(tokens.token, 'env-token')
  assert.equal(tokens.configured, true)
})

test('token hooks keep the desktop keychain copy in step', () => {
  const tokens = new TokenState('')
  const events: Array<[string | null, string | undefined]> = []
  const config = {
    onToken: (token: string | null, login?: string) => { events.push([token, login]) },
  } as unknown as ServerConfig

  setGithubToken(config, tokens, ' device-token ', 'tester')
  assert.equal(tokens.token, 'device-token')
  clearGithubToken(config, tokens)
  assert.equal(tokens.configured, false)
  assert.deepEqual(events, [['device-token', 'tester'], [null, undefined]])
})
