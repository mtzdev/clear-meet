import { contextBridge, ipcRenderer } from 'electron'
import { createRendererApi } from './api'

contextBridge.exposeInMainWorld('api', createRendererApi(ipcRenderer))
