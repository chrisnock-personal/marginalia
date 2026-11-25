import type { LocalRepoInfo } from '../shared/types'

/**
 * The preload script exposes this small, explicit API with contextIsolation on.
 * It never gives the page Node access; all git work still happens in the server.
 */
export interface DesktopBridge {
  apiSecret: string
  chooseFolder(): Promise<string | null>
  listRepos(): Promise<LocalRepoInfo[]>
  addRepo(path: string): Promise<LocalRepoInfo[]>
  removeRepo(id: string): Promise<LocalRepoInfo[]>
  openExternal(url: string): Promise<void>
}

declare global {
  interface Window {
    marginalia?: DesktopBridge
  }
}

export const desktopBridge: DesktopBridge | undefined =
  typeof window !== 'undefined' ? window.marginalia : undefined

export const isDesktop = Boolean(desktopBridge?.apiSecret)
