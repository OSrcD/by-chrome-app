import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

//在预加载脚本中暴露安全的IPC方法
contextBridge.exposeInMainWorld('electronAPI', {
  onSetPort: (callback) => {
    ipcRenderer.on('set-port', (event, portData) => callback(portData))
  },
  invoke: (channel, ...args) => {
    const allowedChannels = [
      'common-choose-path', 
      'run-puppeteer-test', 
      'get-open-windows', 
      'run-gemini-restyle',
      'run-gemini-rewrite-text',
      'run-gemini-restyle-image',
      'run-gemini-restyle-video',
      'run-gemini-undo',
      'test-video-download'
    ]
    if (!allowedChannels.includes(channel)) {
      throw new Error(`非法 IPC 通道: ${channel}`)
    }
    return ipcRenderer.invoke(channel, ...args)
  },
  // 通用 IPC 事件监听（白名单控制）
  on: (channel, callback) => {
    const allowedChannels = ['scraper-log']
    if (!allowedChannels.includes(channel)) {
      throw new Error(`非法 IPC 监听通道: ${channel}`)
    }
    ipcRenderer.on(channel, (event, data) => callback(data))
  }
})


// // Custom APIs for renderer
// const api = {}
//
// // Use `contextBridge` APIs to expose Electron APIs to
// // renderer only if context isolation is enabled, otherwise
// // just add to the DOM global.
// if (process.contextIsolated) {
//   try {
//     contextBridge.exposeInMainWorld('electron', electronAPI)
//     contextBridge.exposeInMainWorld('api', api)
//   } catch (error) {
//     console.error(error)
//   }
// } else {
//   window.electron = electronAPI
//   window.api = api
// }
