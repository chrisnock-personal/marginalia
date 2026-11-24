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
