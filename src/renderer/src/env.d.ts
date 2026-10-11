/// <reference types="vite/client" />

import type { RendererApi } from '@shared/ipc'

declare global {
  interface Window {
    /** Bridge tipada exposta pelo preload (`contextBridge`). */
    api: RendererApi
  }
}
