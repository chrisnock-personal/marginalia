import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { ProviderId } from '../shared/types'
import { GitHubProvider } from './providers/github'
import { localRootsFromEnv, LocalGitProvider } from './providers/local'
import type { GitProvider } from './providers/types'
import { deviceFlowConfigFromEnv, oauthConfigFromEnv, type DeviceFlowConfig, type OAuthConfig } from './oauth'

export interface ServerConfig {
  localRoots: Map<string, string>
  initialToken: string
  initialLogin: string | null
  oauth: OAuthConfig | null
  deviceFlow: DeviceFlowConfig | null
  publicUrl: string
  dryRun: boolean
  port: number
  /** When set, every /api request must carry this secret (header or query). */
  apiSecret: string
  /** Enables the local-repo management UI and hides web-only sign-in options. */
  desktop: boolean
  /** Directory holding the built React app; defaults to dist/client beside cwd. */
  clientDir?: string
  /** Git executable and environment for local repos (desktop uses bundled dugite git). */
  git?: string
  gitEnv?: NodeJS.ProcessEnv
  /** Desktop app persists encrypted tokens here when they change. */
  onToken?: (token: string | null, login?: string) => void
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
    initialLogin: process.env.GITHUB_LOGIN?.trim() || null,
    oauth: oauthConfigFromEnv(),
    deviceFlow: deviceFlowConfigFromEnv(),
    publicUrl: (process.env.MARGINALIA_PUBLIC_URL ?? 'http://127.0.0.1:5173').replace(/\/$/, ''),
    dryRun: process.env.MARGINALIA_DRY_RUN === '1',
    port: Number(process.env.PORT ?? 5174),
    apiSecret: process.env.MARGINALIA_API_SECRET ?? '',
    desktop: process.env.MARGINALIA_DESKTOP === '1',
  }
}

/**
 * A GitHub PAT pasted in the UI lives only in this server process. The desktop
 * app receives it through an encrypted settings write, never a plain file.
 */
export class TokenState {
  private sessionToken: string | null = null
  private login: string | null

  constructor(
    private readonly fallback: string,
    initialLogin: string | null = null,
  ) {
    this.login = initialLogin
  }

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

/** Keep the in-memory token and the desktop keychain entry in step. */
export function setGithubToken(config: ServerConfig, tokens: TokenState, token: string, login: string): void {
  tokens.set(token, login)
  config.onToken?.(token.trim(), login)
}

export function clearGithubToken(config: ServerConfig, tokens: TokenState): void {
  tokens.clear()
  config.onToken?.(null)
}

export function providerFor(
  id: unknown,
  config: ServerConfig,
  tokens: TokenState,
): GitProvider {
  if (id === 'local') {
    return new LocalGitProvider(config.localRoots, {
      dryRun: config.dryRun,
      git: config.git,
      env: config.gitEnv,
      getToken: () => tokens.token,
    })
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
