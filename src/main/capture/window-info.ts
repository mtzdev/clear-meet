import type { WindowTraits } from './filter'
import { parseWindowHandle } from './window-state'

/** Características de uma janela no Windows; `'gone'` se ela já não existe; `null` se não deu para consultar. */
export type WindowTraitsProbe = (sourceId: string) => WindowTraits | 'gone' | null

export interface WindowTools {
  traits: WindowTraitsProbe
  /**
   * Janelas minimizadas (top-level, visíveis, sem dono e com título). O `desktopCapturer` não as
   * lista, então a lista de Fontes as completa com estas.
   */
  minimizedWindows(): { id: string; name: string }[]
  /**
   * Se a janela está minimizada, restaura sem ativá-la (o foco fica onde está) e espera ela
   * voltar. Nunca lança.
   */
  restoreIfMinimized(hwnd: number): Promise<void>
}

export const NO_WINDOW_TOOLS: WindowTools = {
  traits: () => null,
  minimizedWindows: () => [],
  restoreIfMinimized: () => Promise.resolve()
}

const GWL_EXSTYLE = -20
const WS_EX_TOOLWINDOW = 0x80
const WS_EX_APPWINDOW = 0x40000
const WS_EX_NOACTIVATE = 0x08000000
const DWMWA_CLOAKED = 14
const SW_SHOWNOACTIVATE = 4
const GW_OWNER = 4
const MAX_TITLE = 512
const RESTORE_POLL_MS = 50
const RESTORE_TIMEOUT_MS = 1000
/** Tempo para a janela repintar depois de restaurada, antes de a captura começar. */
const REPAINT_MS = 250

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Carrega as consultas de janela da user32 e da dwmapi via FFI (koffi). Fora do Windows, ou se
 * o koffi não carregar, devolve `NO_WINDOW_TOOLS` (a lista de Fontes fica sem os filtros do
 * Windows e janelas minimizadas não são restauradas) e informa o motivo em `log`.
 */
export async function loadWindowTools(log: (message: string) => void): Promise<WindowTools> {
  if (process.platform !== 'win32') return NO_WINDOW_TOOLS
  try {
    const koffi = (await import('koffi')).default
    const user32 = koffi.load('user32.dll')
    const dwmapi = koffi.load('dwmapi.dll')
    koffi.struct('CM_RECT', {
      left: 'int32',
      top: 'int32',
      right: 'int32',
      bottom: 'int32'
    })
    const isWindow = user32.func('int __stdcall IsWindow(intptr_t hwnd)')
    const isVisible = user32.func('int __stdcall IsWindowVisible(intptr_t hwnd)')
    const isIconic = user32.func('int __stdcall IsIconic(intptr_t hwnd)')
    const getExStyle = user32.func('int32 __stdcall GetWindowLongW(intptr_t hwnd, int index)')
    const getRect = user32.func('int __stdcall GetWindowRect(intptr_t hwnd, _Out_ CM_RECT *rect)')
    const getWindow = user32.func('intptr_t __stdcall GetWindow(intptr_t hwnd, uint32 command)')
    const getTitle = user32.func(
      'int __stdcall GetWindowTextW(intptr_t hwnd, _Out_ uint16_t *text, int max)'
    )
    koffi.proto('bool __stdcall CM_ENUM(intptr_t hwnd, intptr_t param)')
    const enumWindows = user32.func('bool __stdcall EnumWindows(CM_ENUM *callback, intptr_t param)')
    const showWindow = user32.func('int __stdcall ShowWindow(intptr_t hwnd, int command)')
    const getAttribute = dwmapi.func(
      'int32 __stdcall DwmGetWindowAttribute(intptr_t hwnd, uint32 attribute, _Out_ int32 *value, uint32 size)'
    )

    const traits: WindowTraitsProbe = (sourceId) => {
      const hwnd = parseWindowHandle(sourceId)
      if (hwnd === null) return null
      try {
        if (isWindow(hwnd) === 0) return 'gone'
        const style = Number(getExStyle(hwnd, GWL_EXSTYLE))
        const rect: { left: number; top: number; right: number; bottom: number } = {
          left: 0,
          top: 0,
          right: 0,
          bottom: 0
        }
        getRect(hwnd, rect)
        const cloaked = [0]
        const status = Number(getAttribute(hwnd, DWMWA_CLOAKED, cloaked, 4))
        return {
          visible: isVisible(hwnd) !== 0,
          minimized: isIconic(hwnd) !== 0,
          cloaked: status === 0 && (cloaked[0] ?? 0) !== 0,
          toolWindow: (style & WS_EX_TOOLWINDOW) !== 0,
          noActivate: (style & WS_EX_NOACTIVATE) !== 0,
          appWindow: (style & WS_EX_APPWINDOW) !== 0,
          width: Math.max(0, rect.right - rect.left),
          height: Math.max(0, rect.bottom - rect.top)
        }
      } catch (error) {
        log(`[window-info] consulta falhou: ${String(error)}`)
        return null
      }
    }

    const minimizedWindows = (): { id: string; name: string }[] => {
      const found: { id: string; name: string }[] = []
      const callback = koffi.register((hwnd: number): boolean => {
        try {
          if (
            isIconic(hwnd) === 0 ||
            isVisible(hwnd) === 0 ||
            Number(getWindow(hwnd, GW_OWNER)) !== 0
          ) {
            return true
          }
          const text = new Uint16Array(MAX_TITLE)
          const length = Number(getTitle(hwnd, text, MAX_TITLE))
          if (length > 0) {
            found.push({
              id: `window:${hwnd}:0`,
              name: String.fromCharCode(...text.subarray(0, length))
            })
          }
        } catch {
          // janela que sumiu durante a enumeração
        }
        return true
      }, 'CM_ENUM *')
      try {
        enumWindows(callback, 0)
      } catch (error) {
        log(`[window-info] não foi possível enumerar as janelas: ${String(error)}`)
      } finally {
        koffi.unregister(callback)
      }
      return found
    }

    const restoreIfMinimized = async (hwnd: number): Promise<void> => {
      try {
        if (isIconic(hwnd) === 0) return
        showWindow(hwnd, SW_SHOWNOACTIVATE)
        const deadline = Date.now() + RESTORE_TIMEOUT_MS
        while (isIconic(hwnd) !== 0 && Date.now() < deadline) await sleep(RESTORE_POLL_MS)
        if (isIconic(hwnd) !== 0) log('[window-info] a janela continuou minimizada após restaurar')
        else await sleep(REPAINT_MS)
      } catch (error) {
        log(`[window-info] não foi possível restaurar a janela: ${String(error)}`)
      }
    }

    return { traits, minimizedWindows, restoreIfMinimized }
  } catch (error) {
    log(`[window-info] user32/dwmapi indisponíveis, filtros de janela desligados: ${String(error)}`)
    return NO_WINDOW_TOOLS
  }
}
