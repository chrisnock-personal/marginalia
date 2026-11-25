import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { App, Rectangle } from 'electron'
import type { LocalRepoInfo } from '../shared/types'

export interface StoredToken {
  encrypted: string
  login?: string
}

export interface DesktopSettings {
  repos: LocalRepoInfo[]
  token?: StoredToken
  bounds?: Rectangle
  /** Optional public OAuth client id for GitHub's device flow. */
  deviceClientId?: string
}

export function settingsPath(app: App): string {
  return join(app.getPath('userData'), 'settings.json')
}

export function readSettings(path: string): DesktopSettings {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as Partial<DesktopSettings>
    return {
      repos: Array.isArray(parsed.repos) ? parsed.repos : [],
      token: parsed.token,
      bounds: parsed.bounds,
      deviceClientId: parsed.deviceClientId,
    }
  } catch {
    return { repos: [] }
  }
}

export function writeSettings(path: string, settings: DesktopSettings): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(settings, null, 2)}\n`, 'utf8')
}
