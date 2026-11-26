import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from './index'

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { app, config } = createServer()
  app.listen(config.port, '127.0.0.1', () => {
    console.log(`Marginalia API listening on http://127.0.0.1:${config.port}`)
  })
}
