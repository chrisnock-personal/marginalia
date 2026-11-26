import express from 'express'
import { timingSafeEqual } from 'node:crypto'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { HttpError, loadConfig, TokenState, type ServerConfig } from './config'
import { createApiRouter } from './routes'

function secretMatches(supplied: string, expected: string): boolean {
  const a = Buffer.from(supplied)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

export function createServer(overrides: Partial<ServerConfig> = {}): {
  app: express.Express
  config: ServerConfig
  tokens: TokenState
} {
  const config: ServerConfig = { ...loadConfig(), ...overrides }
  const tokens = new TokenState(config.initialToken, config.initialLogin)
  const app = express()
  app.use(express.json({ limit: '5mb' }))

  if (config.apiSecret) {
    app.use('/api', (req, res, next) => {
      const querySecret = req.query.secret
      const supplied =
        req.header('x-marginalia-api-secret') ??
        (typeof querySecret === 'string' ? querySecret : '')
      if (!secretMatches(supplied, config.apiSecret)) {
        res.status(401).json({ error: 'Invalid API secret' })
        return
      }
      next()
    })
  }
  app.use('/api', createApiRouter(config, tokens))

  const clientDir = resolve(config.clientDir ?? resolve(process.cwd(), 'dist/client'))
  if (existsSync(clientDir)) {
    app.use(express.static(clientDir))
    app.get('/{*path}', (_req, res) => res.sendFile(join(clientDir, 'index.html')))
  }

  app.use((error: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (res.headersSent) return next(error)
    const err = error as Error & { status?: number }
    const status = error instanceof HttpError ? error.status : (err.status ?? 500)
    if (status >= 500) console.error(error)
    res.status(status).json({ error: err.message || 'Internal server error' })
  })

  return { app, config, tokens }
}
