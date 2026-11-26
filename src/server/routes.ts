import express, { type Router } from 'express'
import type { PublishRequest } from '../shared/types'
import { clearGithubToken, HttpError, providerFor, setGithubToken, type ServerConfig, type TokenState } from './config'
import { GitHubProvider } from './providers/github'
import {
  authorizeUrl,
  exchangeCode,
  OAuthState,
  pollDeviceCode,
  requestDeviceCode,
} from './oauth'

export function createApiRouter(config: ServerConfig, tokens: TokenState): Router {
  const router = express.Router()
  const oauthStates = new OAuthState()

  router.get('/config', (_req, res) => {
    res.json({
      desktop: config.desktop,
      localRepos: config.desktop
        ? [...config.localRoots].map(([id, repoPath]) => ({ id, path: repoPath }))
        : [],
      providers: [
        {
          id: 'local',
          label: 'Local git repos',
          configured: config.localRoots.size > 0,
          detail: `${config.localRoots.size} repo(s) configured`,
          dryRun: config.dryRun,
        },
        {
          id: 'github',
          label: config.desktop ? 'GitHub' : 'GitHub (PAT)',
          configured: tokens.configured,
          detail: tokens.user ? `Authenticated as ${tokens.user}` : undefined,
          oauthConfigured: Boolean(config.oauth),
          deviceFlowConfigured: Boolean(config.deviceFlow),
        },
      ],
    })
  })

  /** Validate and install a GitHub PAT for this server process. */
  router.post('/token', async (req, res) => {
    const token = typeof req.body?.token === 'string' ? req.body.token.trim() : ''
    if (!token) throw new HttpError(400, 'A PAT is required')
    let user: { login: string }
    try {
      user = await new GitHubProvider(() => token).whoAmI()
    } catch (err) {
      if (/\b(401|403)\b/.test((err as Error).message)) throw new HttpError(401, 'GitHub rejected that PAT')
      throw err
    }
    setGithubToken(config, tokens, token, user.login)
    res.json({ configured: true, login: user.login })
  })

  router.delete('/token', (_req, res) => {
    clearGithubToken(config, tokens)
    res.json({ configured: tokens.configured })
  })

  router.get('/auth/github/url', (_req, res) => {
    if (!config.oauth) throw new HttpError(400, 'GitHub OAuth is not configured')
    res.json({ url: authorizeUrl(config.oauth, oauthStates.issue()) })
  })

  router.get('/auth/github/callback', async (req, res) => {
    const code = typeof req.query.code === 'string' ? req.query.code : ''
    const state = typeof req.query.state === 'string' ? req.query.state : ''
    const fail = (message: string) =>
      res.redirect(`${config.publicUrl}/?auth=error&message=${encodeURIComponent(message)}`)
    if (!config.oauth || !code || !state || !oauthStates.consume(state)) {
      fail('Invalid GitHub sign-in response')
      return
    }
    try {
      const token = await exchangeCode(config.oauth, code)
      const user = await new GitHubProvider(() => token).whoAmI()
      setGithubToken(config, tokens, token, user.login)
      res.redirect(`${config.publicUrl}/?auth=success`)
    } catch (error) {
      fail(`GitHub sign-in failed: ${(error as Error).message}`)
    }
  })

  // Device code -> expiry time; codes nobody finishes are dropped once expired.
  const deviceCodes = new Map<string, number>()
  const pruneDeviceCodes = () => {
    const now = Date.now()
    for (const [code, expires] of deviceCodes) if (expires <= now) deviceCodes.delete(code)
  }

  /** Desktop sign-in: show a code, then poll until GitHub authorizes it. */
  router.post('/auth/github/device', async (_req, res) => {
    if (!config.deviceFlow) throw new HttpError(400, 'GitHub device sign-in is not configured')
    const code = await requestDeviceCode(config.deviceFlow)
    pruneDeviceCodes()
    deviceCodes.set(code.device_code, Date.now() + code.expires_in * 1000)
    res.json({
      deviceCode: code.device_code,
      userCode: code.user_code,
      verificationUri: code.verification_uri,
      expiresIn: code.expires_in,
      interval: code.interval,
    })
  })

  router.post('/auth/github/device/poll', async (req, res) => {
    const deviceCode = typeof req.body?.deviceCode === 'string' ? req.body.deviceCode : ''
    pruneDeviceCodes()
    if (!config.deviceFlow || !deviceCode || !deviceCodes.has(deviceCode)) {
      throw new HttpError(400, 'Unknown device sign-in session')
    }
    const result = await pollDeviceCode(config.deviceFlow, deviceCode)
    if ('pending' in result && result.pending) {
      res.json({ pending: true, slowDown: result.slowDown })
      return
    }
    const token = 'token' in result ? result.token : ''
    const user = await new GitHubProvider(() => token).whoAmI()
    setGithubToken(config, tokens, token, user.login)
    deviceCodes.delete(deviceCode)
    res.json({ pending: false, configured: true, login: user.login })
  })

  router.get('/repos', async (req, res) => {
    const provider = providerFor(req.query.provider ?? defaultProvider(config, tokens), config, tokens)
    res.json(await provider.listRepos())
  })

  router.get('/repos/:provider/:repo/head', async (req, res) => {
    const provider = providerFor(req.params.provider, config, tokens)
    const ref = typeof req.query.ref === 'string' ? req.query.ref : undefined
    res.json({ sha: await provider.headSha(req.params.repo, ref) })
  })

  router.get('/repos/:provider/:repo/files', async (req, res) => {
    const provider = providerFor(req.params.provider, config, tokens)
    const ref = typeof req.query.ref === 'string' ? req.query.ref : undefined
    res.json(await provider.listMarkdownFiles(req.params.repo, ref))
  })

  router.get('/repos/:provider/:repo/assets', async (req, res) => {
    const provider = providerFor(req.params.provider, config, tokens)
    const ref = typeof req.query.ref === 'string' ? req.query.ref : undefined
    res.json(await provider.listAssets(req.params.repo, ref))
  })

  router.get('/repos/:provider/:repo/file', async (req, res) => {
    const path = typeof req.query.path === 'string' ? req.query.path : ''
    if (!path) throw new HttpError(400, 'path is required')
    const ref = typeof req.query.ref === 'string' ? req.query.ref : undefined
    const provider = providerFor(req.params.provider, config, tokens)
    const content = await provider.readFile(req.params.repo, path, ref)
    if (content === null) throw new HttpError(404, `File not found: ${path}`)
    res.json({ path, content })
  })

  router.get('/repos/:provider/:repo/asset', async (req, res) => {
    const assetPath = typeof req.query.path === 'string' ? req.query.path : ''
    if (!assetPath) throw new HttpError(400, 'path is required')
    const ref = typeof req.query.ref === 'string' ? req.query.ref : undefined
    const provider = providerFor(req.params.provider, config, tokens)
    let data: Buffer | null
    try {
      data = await provider.readAsset(req.params.repo, assetPath, ref)
    } catch (error) {
      throw new HttpError(400, (error as Error).message)
    }
    if (!data) throw new HttpError(404, `Asset not found: ${assetPath}`)
    const extension = assetPath.split('.').pop()?.toLowerCase() ?? ''
    const mime = ASSET_TYPES[extension] ?? 'application/octet-stream'
    res.setHeader('Cache-Control', 'no-store')
    res.type(mime).send(data)
  })

  router.post('/publish', async (req, res) => {
    const body = req.body as Partial<PublishRequest> | undefined
    if (
      !body ||
      typeof body.repo !== 'string' ||
      typeof body.branch !== 'string' ||
      typeof body.commitMessage !== 'string' ||
      !Array.isArray(body.files) ||
      !body.files.every(
        (f) =>
          typeof f?.path === 'string' &&
          typeof f?.content === 'string' &&
          (f.encoding === undefined || f.encoding === 'utf8' || f.encoding === 'base64') &&
          (f.delete === undefined || typeof f.delete === 'boolean'),
      ) ||
      !body.comments ||
      body.comments.version !== 1 ||
      !Array.isArray(body.comments.comments)
    ) {
      throw new HttpError(400, 'Invalid publish request')
    }
    if (body.baseRef !== undefined && typeof body.baseRef !== 'string') {
      throw new HttpError(400, 'Invalid baseRef')
    }
    const provider = providerFor(body.provider, config, tokens)
    if (body.baseSha && typeof body.baseSha === 'string') {
      const current = await provider.headSha(body.repo, body.baseRef)
      if (current !== body.baseSha) {
        throw new HttpError(409, 'Base branch changed since you opened the file. Reload before publishing.')
      }
    }
    const result = await provider.publish(body as PublishRequest)
    res.json(result)
  })

  return router
}

const ASSET_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  avif: 'image/avif',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
}

function defaultProvider(config: ServerConfig, tokens: TokenState): string {
  if (config.localRoots.size > 0) return 'local'
  if (tokens.configured) return 'github'
  throw new HttpError(400, 'Configure a local repo or a GitHub PAT first')
}
