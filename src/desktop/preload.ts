import { contextBridge, ipcRenderer } from 'electron'

const flag = process.argv.find((arg) => arg.startsWith('--marginalia-api-secret='))
const apiSecret = flag?.slice('--marginalia-api-secret='.length) ?? ''

contextBridge.exposeInMainWorld('marginalia', {
  apiSecret,
  chooseFolder: () => ipcRenderer.invoke('marginalia:chooseFolder'),
  listRepos: () => ipcRenderer.invoke('marginalia:listRepos'),
  addRepo: (path: string) => ipcRenderer.invoke('marginalia:addRepo', path),
  removeRepo: (id: string) => ipcRenderer.invoke('marginalia:removeRepo', id),
  openExternal: (url: string) => ipcRenderer.invoke('marginalia:openExternal', url),
})
