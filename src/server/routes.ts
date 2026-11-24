import express, { type Router } from 'express'
import type { PublishRequest } from '../shared/types'
import { HttpError, providerFor, type ServerConfig, type TokenState } from './config'
import { GitHubProvider } from './providers/github'

export function createApiRouter(config: ServerConfig, tokens: TokenState): Router {
  const router = express.Router()

  router.get('/config', (_req, res) => {
    res.json({
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
          label: 'GitHub (PAT)',
          configured: tokens.configured,
          detail: tokens.user ? `Authenticated as ${tokens.user}` : undefined,
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
    tokens.set(token, user.login)
    res.json({ configured: true, login: user.login })
  })

  router.delete('/token', (_req, res) => {
    tokens.clear()
    res.json({ configured: tokens.configured })
  })

  router.get('/repos', async (req, res) => {
    const provider = providerFor(req.query.provider ?? defaultProvider(config, tokens), config, tokens)
    res.json(await provider.listRepos())
  })

  router.get('/repos/:provider/:repo/files', async (req, res) => {
    const provider = providerFor(req.params.provider, config, tokens)
    const ref = typeof req.query.ref === 'string' ? req.query.ref : undefined
    res.json(await provider.listMarkdownFiles(req.params.repo, ref))
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

  router.post('/publish', async (req, res) => {
    const body = req.body as Partial<PublishRequest> | undefined
    if (
      !body ||
      typeof body.repo !== 'string' ||
      typeof body.branch !== 'string' ||
      typeof body.commitMessage !== 'string' ||
      !Array.isArray(body.files) ||
      !body.files.every((f) => typeof f?.path === 'string' && typeof f?.content === 'string') ||
      !body.comments ||
      body.comments.version !== 1 ||
      !Array.isArray(body.comments.comments)
    ) {
      throw new HttpError(400, 'Invalid publish request')
    }
    const provider = providerFor(body.provider, config, tokens)
    const result = await provider.publish(body as PublishRequest)
    res.json(result)
  })

  return router
}

function defaultProvider(config: ServerConfig, tokens: TokenState): string {
  if (config.localRoots.size > 0) return 'local'
  if (tokens.configured) return 'github'
  throw new HttpError(400, 'Configure a local repo or a GitHub PAT first')
}
