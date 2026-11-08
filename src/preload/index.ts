import { contextBridge, ipcRenderer } from 'electron'
import type { PrLensApi, ReviewEvent } from '../shared/types'

const api: PrLensApi = {
  pickRepo: () => ipcRenderer.invoke('repo:pick'),
  openRepo: (p) => ipcRenderer.invoke('repo:open', p),
  fetch: (repo) => ipcRenderer.invoke('repo:fetch', repo),
  compare: (repo, base, head, ws) => ipcRenderer.invoke('repo:compare', repo, base, head, ws),
  filePair: (repo, mergeBase, head, file) => ipcRenderer.invoke('repo:filePair', repo, mergeBase, head, file),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (u) => ipcRenderer.invoke('settings:save', u),
  startReview: (req) => ipcRenderer.invoke('review:start', req),
  cancelReview: (id) => ipcRenderer.invoke('review:cancel', id),
  claudeCliAvailable: () => ipcRenderer.invoke('claude:available'),
  onReviewEvent: (cb) => {
    const listener = (_: unknown, e: ReviewEvent) => cb(e)
    ipcRenderer.on('review:event', listener)
    return () => ipcRenderer.removeListener('review:event', listener)
  }
}

contextBridge.exposeInMainWorld('api', api)
