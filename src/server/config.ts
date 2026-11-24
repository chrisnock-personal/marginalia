import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { ProviderId } from '../shared/types'
import { GitHubProvider } from './providers/github'
import { localRootsFromEnv, LocalGitProvider } from './providers/local'
import type { GitProvider } from './providers/types'
import { oauthConfigFromEnv, type OAuthConfig } from './oauth'

export interface ServerConfig {
  localRoots: Map<string, string>
  initialToken: string
  oauth: OAuthConfig | null
  publicUrl: string
  dryRun: boolean
  port: number
}

export function loadConfig(): ServerConfig {
  const tokenFile = process.env.MARGINALIA_TOKEN_FILE
  let fileToken = ''
  if (tokenFile) {
    const path = resolve(tokenFile)
    if (!existsSync(path)) throw new Error(`MARGINALIA_TOKEN_FILE does not exist: ${path}`)
    fileToken = readFileSync(path, 'utf8').trim()
  }
  return {
    localRoots: localRootsFromEnv(process.env.MARGINALIA_LOCAL_REPOS),
    initialToken: process.env.GITHUB_TOKEN?.trim() || fileToken,
    oauth: oauthConfigFromEnv(),
    publicUrl: (process.env.MARGINALIA_PUBLIC_URL ?? 'http://127.0.0.1:5173').replace(/\/$/, ''),
    dryRun: process.env.MARGINALIA_DRY_RUN === '1',
    port: Number(process.env.PORT ?? 5174),
  }
}

/**
 * A PAT pasted in the UI lives only in this server process. It is never sent to
 * the browser, stored in localStorage, or written to disk.
 */
export class TokenState {
  private sessionToken: string | null = null
  private login: string | null = null

  constructor(private readonly fallback: string) {}

  get token(): string {
    return this.sessionToken ?? this.fallback
  }

  get configured(): boolean {
    return Boolean(this.token)
  }

  get user(): string | null {
    return this.login
  }

  set(token: string, login: string): void {
    this.sessionToken = token.trim()
    this.login = login
  }

  clear(): void {
    this.sessionToken = null
    this.login = null
  }
}

export function providerFor(
  id: unknown,
  config: ServerConfig,
  tokens: TokenState,
): GitProvider {
  if (id === 'local') {
    return new LocalGitProvider(config.localRoots, { dryRun: config.dryRun })
  }
  if (id === 'github') {
    if (!tokens.configured) throw new HttpError(401, 'Connect a GitHub PAT first')
    return new GitHubProvider(() => tokens.token)
  }
  throw new HttpError(400, `Unknown provider: ${String(id)}`)
}

export function providerIds(): ProviderId[] {
  return ['local', 'github']
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}
