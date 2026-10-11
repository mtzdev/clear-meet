import { Menu, nativeImage, Tray } from 'electron'
import { renderTrayIcon } from './tray-icon'

const ICON_PIXELS = 32
const TOOLTIP = 'ClearMeet — gravando'

export interface TrayActions {
  showMain(): void
  /** Para a gravação e salva (como o botão da barra). */
  stop(): void
  /** Para e salva a gravação e sai do app. */
  quit(): void
}

/**
 * Ícone da bandeja que existe só enquanto há gravação ativa: clique (simples ou duplo)
 * mostra a janela principal; o menu tem "Mostrar", "Parar gravação" e "Sair".
 */
export function createRecordingTray(actions: TrayActions): { show(): void; hide(): void } {
  let tray: Tray | null = null
  return {
    show() {
      if (tray) return
      const icon = nativeImage.createFromBitmap(renderTrayIcon(ICON_PIXELS), {
        width: ICON_PIXELS,
        height: ICON_PIXELS,
        scaleFactor: 2
      })
      const created = new Tray(icon)
      created.setToolTip(TOOLTIP)
      created.setContextMenu(
        Menu.buildFromTemplate([
          { label: 'Mostrar ClearMeet', click: () => actions.showMain() },
          { label: 'Parar gravação', click: () => actions.stop() },
          { type: 'separator' },
          { label: 'Sair do ClearMeet', click: () => actions.quit() }
        ])
      )
      created.on('click', () => actions.showMain())
      created.on('double-click', () => actions.showMain())
      tray = created
    },
    hide() {
      if (!tray) return
      tray.destroy()
      tray = null
    }
  }
}
