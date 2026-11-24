import express from 'express'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { HttpError, loadConfig, TokenState, type ServerConfig } from './config'
import { createApiRouter } from './routes'

export function createServer(): { app: express.Express; config: ServerConfig; tokens: TokenState } {
  const config = loadConfig()
  const tokens = new TokenState(config.initialToken)
  const app = express()
  app.use(express.json({ limit: '5mb' }))
  app.use('/api', createApiRouter(config, tokens))

  const clientDir = resolve(process.cwd(), 'dist/client')
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

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { app, config } = createServer()
  app.listen(config.port, () => {
    console.log(`Marginalia API listening on http://127.0.0.1:${config.port}`)
  })
}
