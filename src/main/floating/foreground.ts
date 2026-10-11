/**
 * Janela em primeiro plano, consultada e restaurada direto no Windows (user32). O campo de
 * Anotação abre sobre o app em uso (Zoom, Teams…) e, ao fechar, o foco precisa voltar para
 * ele. Esconder a janela focada já costuma devolver o foco; isto garante o caso em que o
 * Windows escolhe outra janela.
 */
export interface ForegroundTools {
  /** HWND da janela em primeiro plano agora, ou `null`. */
  capture(): number | null
  /** Devolve o foco a essa janela (se ela ainda existir). Nunca lança. */
  restore(hwnd: number): void
}

export const NO_FOREGROUND: ForegroundTools = { capture: () => null, restore: () => undefined }

/**
 * Carrega `GetForegroundWindow`/`SetForegroundWindow` via FFI (koffi). Fora do Windows, ou se
 * o koffi não carregar, devolve `NO_FOREGROUND` (o foco volta só pelo comportamento normal do
 * Windows ao esconder a janela) e informa o motivo em `log`.
 */
export async function loadForegroundTools(
  log: (message: string) => void
): Promise<ForegroundTools> {
  if (process.platform !== 'win32') return NO_FOREGROUND
  try {
    const koffi = (await import('koffi')).default
    const user32 = koffi.load('user32.dll')
    const getForeground = user32.func('intptr_t __stdcall GetForegroundWindow()')
    const setForeground = user32.func('int __stdcall SetForegroundWindow(intptr_t hwnd)')
    const isWindow = user32.func('int __stdcall IsWindow(intptr_t hwnd)')
    return {
      capture: () => {
        try {
          const hwnd = Number(getForeground())
          return Number.isSafeInteger(hwnd) && hwnd > 0 ? hwnd : null
        } catch (error) {
          log(`[foreground] consulta falhou: ${String(error)}`)
          return null
        }
      },
      restore: (hwnd) => {
        try {
          if (isWindow(hwnd) !== 0) setForeground(hwnd)
        } catch (error) {
          log(`[foreground] não foi possível restaurar o foco: ${String(error)}`)
        }
      }
    }
  } catch (error) {
    log(
      `[foreground] user32 indisponível, o foco volta pelo comportamento padrão: ${String(error)}`
    )
    return NO_FOREGROUND
  }
}
