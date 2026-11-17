import { contextBridge, ipcRenderer } from 'electron'
import type { AnswerEvent, DesktopAPI } from './contract.cjs'

const desktop: DesktopAPI = {
  version: () => ipcRenderer.invoke('version'),
  checkUpdate: () => ipcRenderer.invoke('check-update'),
  installUpdate: () => ipcRenderer.invoke('install-update'),
  setView: view => ipcRenderer.invoke('view', view),
  windowAction: action => ipcRenderer.invoke('window-action', action),
  answer: request => ipcRenderer.invoke('answer', request),
  cancelAnswer: id => ipcRenderer.invoke('cancel-answer', id),
  onAnswer(listener) {
    const onChunk = (_event: Electron.IpcRendererEvent, chunk: AnswerEvent) => listener(chunk)
    ipcRenderer.on('answer-chunk', onChunk)
    return () => ipcRenderer.off('answer-chunk', onChunk)
  },
  copy: text => ipcRenderer.invoke('copy', text),
}

contextBridge.exposeInMainWorld('desktop', desktop)
