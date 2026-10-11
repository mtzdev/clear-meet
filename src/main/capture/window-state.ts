/**
 * Estado da janela gravada, consultado direto no Windows (user32). A falta de quadros não serve
 * para detectar janela minimizada: o Windows Graphics Capture só entrega quadros quando o
 * conteúdo muda, então uma janela parada e visível também fica em silêncio.
 */

export type WindowState = 'normal' | 'minimized' | 'gone'

/** Consulta o estado de uma janela pelo HWND. Nunca lança: na dúvida devolve `'normal'`. */
export type WindowStateProbe = (hwnd: number) => WindowState

/**
 * HWND de uma Fonte de captura do tipo janela. O id do `desktopCapturer` é
 * `window:<HWND>:<n>` (no Windows o primeiro número é o HWND, em decimal). `null` se o id
 * não tem essa forma (tela, formato desconhecido).
 */
export function parseWindowHandle(sourceId: string): number | null {
  const match = /^window:(\d+):\d+$/.exec(sourceId)
  if (!match?.[1]) return null
  const hwnd = Number(match[1])
  return Number.isSafeInteger(hwnd) && hwnd > 0 ? hwnd : null
}

/** Sonda que nunca acusa nada, para quando a consulta nativa não existe (outro SO, falha ao carregar). */
export const NO_WINDOW_STATE: WindowStateProbe = () => 'normal'

/**
 * Carrega `IsIconic`/`IsWindow` da user32 via FFI (koffi). Fora do Windows, ou se o koffi não
 * carregar, devolve `NO_WINDOW_STATE` (o aviso de janela minimizada deixa de aparecer, o resto
 * da gravação não é afetado) e informa o motivo em `log`.
 */
export async function loadWindowStateProbe(
  log: (message: string) => void
): Promise<WindowStateProbe> {
  if (process.platform !== 'win32') return NO_WINDOW_STATE
  try {
    const koffi = (await import('koffi')).default
    const user32 = koffi.load('user32.dll')
    const isIconic = user32.func('int __stdcall IsIconic(intptr_t hwnd)')
    const isWindow = user32.func('int __stdcall IsWindow(intptr_t hwnd)')
    return (hwnd) => {
      try {
        if (isWindow(hwnd) === 0) return 'gone'
        return isIconic(hwnd) !== 0 ? 'minimized' : 'normal'
      } catch (error) {
        log(`[window-state] consulta falhou: ${String(error)}`)
        return 'normal'
      }
    }
  } catch (error) {
    log(
      `[window-state] user32 indisponível, aviso de janela minimizada desligado: ${String(error)}`
    )
    return NO_WINDOW_STATE
  }
}
