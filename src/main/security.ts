import type { Session, WebContents } from 'electron'

/** Permissões que o app usa: microfone, captura de tela/áudio e tela cheia (player). As demais são negadas. */
const ALLOWED = new Set(['media', 'display-capture', 'fullscreen'])

/**
 * Só as janelas do próprio app (UI e janela de gravação) podem usar microfone e captura;
 * o resto é negado. `isTrusted` diz se um `webContents` é uma delas.
 */
export function installPermissionHandlers(
  session: Session,
  isTrusted: (contents: WebContents | null) => boolean
): void {
  session.setPermissionRequestHandler((contents, permission, callback) => {
    callback(isTrusted(contents) && ALLOWED.has(permission))
  })
  session.setPermissionCheckHandler(
    (contents, permission) => isTrusted(contents) && ALLOWED.has(permission)
  )
}
