import { contextBridge, ipcRenderer } from 'electron'
import type { AnswerEvent, DesktopAPI, LiveStatus } from './contract.cjs'

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
  startLive: options => ipcRenderer.invoke('live-start', options),
  prepareLive: (options, model) => ipcRenderer.invoke('live-prepare', { options, model }),
  stopLive: () => ipcRenderer.invoke('live-stop'),
  transcribe: wav => ipcRenderer.invoke('live-transcribe', wav),
  onLiveStatus(listener) {
    const onStatus = (_event: Electron.IpcRendererEvent, status: LiveStatus) => listener(status)
    ipcRenderer.on('live-status', onStatus)
    return () => ipcRenderer.off('live-status', onStatus)
  },
}

contextBridge.exposeInMainWorld('desktop', desktop)
