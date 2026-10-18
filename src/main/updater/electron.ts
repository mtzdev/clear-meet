import { autoUpdater } from 'electron-updater'
import type { UpdateEvent } from '@shared/update'
import type { UpdateDriver } from './service'

/**
 * Liga o `electron-updater` (releases do GitHub) ao serviço. Baixa sozinho em segundo plano e
 * instala ao fechar o app; erros vão só para o log.
 */
export function createElectronUpdateDriver(log: (message: string) => void): UpdateDriver {
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.autoRunAppAfterInstall = true
  autoUpdater.allowPrerelease = false
  autoUpdater.allowDowngrade = false
  autoUpdater.logger = {
    info: (message) => log(`[updater] ${String(message)}`),
    warn: (message) => log(`[updater] ${String(message)}`),
    error: (message) => log(`[updater] ${String(message)}`),
    debug: () => undefined
  }
  return {
    subscribe(listener: (event: UpdateEvent) => void) {
      autoUpdater.on('checking-for-update', () => listener({ type: 'checking' }))
      autoUpdater.on('update-available', (info) =>
        listener({ type: 'available', version: info.version })
      )
      autoUpdater.on('download-progress', (progress) =>
        listener({ type: 'progress', percent: progress.percent })
      )
      autoUpdater.on('update-downloaded', (info) =>
        listener({ type: 'downloaded', version: info.version })
      )
      autoUpdater.on('update-not-available', () => listener({ type: 'not-available' }))
      autoUpdater.on('error', () => listener({ type: 'error' }))
    },
    async check() {
      await autoUpdater.checkForUpdates()
    },
    quitAndInstall() {
      // Instalação silenciosa, com o app reabrindo ao terminar.
      autoUpdater.quitAndInstall(true, true)
    }
  }
}
