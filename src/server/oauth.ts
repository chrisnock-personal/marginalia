import { randomBytes } from 'node:crypto'

export interface OAuthConfig {
  clientId: string
  clientSecret: string
  redirectUri: string
}

export function oauthConfigFromEnv(): OAuthConfig | null {
  const clientId = process.env.GITHUB_CLIENT_ID?.trim()
  const clientSecret = process.env.GITHUB_CLIENT_SECRET?.trim()
  if (!clientId || !clientSecret) return null
  return {
    clientId,
    clientSecret,
    redirectUri:
      process.env.MARGINALIA_OAUTH_REDIRECT_URI?.trim() ||
      'http://127.0.0.1:5174/api/auth/github/callback',
  }
}

/** Single-use, short-lived state values for the OAuth redirect. */
export class OAuthState {
  private readonly pending = new Map<string, number>()
  private readonly lifetimeMs = 10 * 60 * 1000

  issue(): string {
    const state = randomBytes(24).toString('hex')
    this.pending.set(state, Date.now() + this.lifetimeMs)
    return state
  }

  consume(state: string): boolean {
    const expires = this.pending.get(state)
    if (!expires) return false
    this.pending.delete(state)
    return expires > Date.now()
  }
}

export function authorizeUrl(config: OAuthConfig, state: string): string {
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    scope: 'repo,read:user',
    state,
  })
  return `https://github.com/login/oauth/authorize?${params}`
}

export async function exchangeCode(
  config: OAuthConfig,
  code: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const response = await fetchImpl('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code,
      redirect_uri: config.redirectUri,
    }),
  })
  if (!response.ok) throw new Error(`GitHub token exchange failed: ${response.status}`)
  const result = (await response.json()) as {
    access_token?: string
    error?: string
    error_description?: string
  }
  if (!result.access_token) {
    throw new Error(result.error_description || result.error || 'GitHub returned no access token')
  }
  return result.access_token
}

/** GitHub's device flow is usable from a desktop app: no client secret or redirect URI. */
export interface DeviceFlowConfig {
  clientId: string
}

export interface DeviceCodeResponse {
  device_code: string
  user_code: string
  verification_uri: string
  expires_in: number
  interval: number
}

export interface DeviceFlowConfigResponse {
  deviceCode: string
  userCode: string
  verificationUri: string
  expiresIn: number
  interval: number
}

export type DevicePollResult =
  | { pending: true; slowDown: boolean }
  | { pending: false; token: string }

export function deviceFlowConfigFromEnv(): DeviceFlowConfig | null {
  const clientId =
    process.env.MARGINALIA_GITHUB_CLIENT_ID?.trim() || process.env.GITHUB_CLIENT_ID?.trim()
  return clientId ? { clientId } : null
}

async function githubDevicePost(body: Record<string, string>, fetchImpl: typeof fetch): Promise<Record<string, unknown>> {
  const response = await fetchImpl('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!response.ok) throw new Error(`GitHub device request failed: ${response.status}`)
  return (await response.json()) as Record<string, unknown>
}

export async function requestDeviceCode(
  config: DeviceFlowConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<DeviceCodeResponse> {
  const response = await fetchImpl('https://github.com/login/device/code', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: config.clientId, scope: 'repo,read:user' }),
  })
  if (!response.ok) throw new Error(`GitHub device code request failed: ${response.status}`)
  const result = (await response.json()) as DeviceCodeResponse & { error?: string; error_description?: string }
  if (!result.device_code) {
    throw new Error(result.error_description || result.error || 'GitHub returned no device code')
  }
  return result
}

/**
 * One poll of GitHub's device token endpoint. `authorization_pending` and
 * `slow_down` are normal; other errors are thrown so the route can report them.
 */
export async function pollDeviceCode(
  config: DeviceFlowConfig,
  deviceCode: string,
  fetchImpl: typeof fetch = fetch,
): Promise<DevicePollResult> {
  const result = await githubDevicePost({
    client_id: config.clientId,
    device_code: deviceCode,
    grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
  }, fetchImpl)
  if (typeof result.access_token === 'string' && result.access_token) {
    return { pending: false, token: result.access_token }
  }
  if (result.error === 'authorization_pending' || result.error === 'slow_down') {
    return { pending: true, slowDown: result.error === 'slow_down' }
  }
  throw new Error(
    String(result.error_description || result.error || 'GitHub returned no device token'),
  )
}
