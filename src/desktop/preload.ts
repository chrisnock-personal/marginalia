import { contextBridge, ipcRenderer } from 'electron'

// Fetched over IPC, not passed on the command line: other local users can
// read a process's arguments. Sync so the page has it before its first fetch.
const apiSecret = String(ipcRenderer.sendSync('marginalia:apiSecret') ?? '')

contextBridge.exposeInMainWorld('marginalia', {
  apiSecret,
  chooseFolder: () => ipcRenderer.invoke('marginalia:chooseFolder'),
  listRepos: () => ipcRenderer.invoke('marginalia:listRepos'),
  addRepo: (path: string) => ipcRenderer.invoke('marginalia:addRepo', path),
  removeRepo: (id: string) => ipcRenderer.invoke('marginalia:removeRepo', id),
  openExternal: (url: string) => ipcRenderer.invoke('marginalia:openExternal', url),
})
