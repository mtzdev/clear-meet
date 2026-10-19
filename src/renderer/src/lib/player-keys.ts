export type PlayerKeyAction =
  | 'toggle'
  | 'back'
  | 'forward'
  | 'back-long'
  | 'forward-long'
  | 'frame-back'
  | 'frame-forward'
  | 'mute'
  | 'fullscreen'
  | 'zoom-in'
  | 'zoom-out'
  | 'zoom-reset'

export interface PlayerKeyContext {
  /** O foco está num campo de texto (input de texto, textarea, select, contenteditable). */
  inTextField: boolean
  /** O foco está dentro de um diálogo, menu ou lista aberta. */
  inOverlay: boolean
  /** Ctrl, Alt ou Meta apertado: o atalho é de outro lugar. */
  modified: boolean
  shift?: boolean
  paused?: boolean
}

export function playerKeyAction(key: string, context: PlayerKeyContext): PlayerKeyAction | null {
  if (context.inTextField || context.inOverlay || context.modified) return null
  switch (key) {
    case ' ':
    case 'Spacebar':
    case 'k':
    case 'K':
      return 'toggle'
    case 'ArrowLeft':
      return context.shift ? 'back-long' : 'back'
    case 'ArrowRight':
      return context.shift ? 'forward-long' : 'forward'
    case 'j':
    case 'J':
      return 'back-long'
    case 'l':
    case 'L':
      return 'forward-long'
    case ',':
      return context.paused ? 'frame-back' : null
    case '.':
      return context.paused ? 'frame-forward' : null
    case 'm':
    case 'M':
      return 'mute'
    case 'f':
    case 'F':
      return 'fullscreen'
    case '+':
    case '=':
      return 'zoom-in'
    case '-':
    case '_':
      return 'zoom-out'
    case '0':
      return 'zoom-reset'
    default:
      return null
  }
}

/** Atalhos mostrados na ajuda do player. */
export const PLAYER_SHORTCUTS: readonly { keys: string; label: string; video?: boolean }[] = [
  { keys: 'Espaço, K', label: 'Tocar ou pausar' },
  { keys: '← →', label: 'Voltar ou avançar 5 s' },
  { keys: 'J L, Shift + ← →', label: 'Voltar ou avançar 15 s' },
  { keys: ', .', label: 'Quadro a quadro (pausado)', video: true },
  { keys: 'M', label: 'Silenciar' },
  { keys: 'F', label: 'Tela cheia', video: true },
  { keys: '+ −', label: 'Aumentar ou diminuir o zoom', video: true },
  { keys: '0', label: 'Ajustar à área', video: true }
]

const NON_TEXT_INPUT_TYPES = new Set([
  'button',
  'checkbox',
  'radio',
  'range',
  'submit',
  'reset',
  'image',
  'file',
  'color'
])

/** Estrutura mínima de um elemento, para poder testar sem DOM. */
export interface ElementLike {
  tagName?: string
  type?: string
  isContentEditable?: boolean
  closest?: (selector: string) => unknown
}

export function isTextEntry(target: ElementLike | null): boolean {
  if (!target) return false
  const tag = target.tagName?.toLowerCase()
  if (tag === 'textarea' || tag === 'select') return true
  if (tag === 'input') return !NON_TEXT_INPUT_TYPES.has((target.type ?? 'text').toLowerCase())
  return target.isContentEditable === true
}

const OVERLAY_SELECTOR = '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]'

export function isInsideOverlay(target: ElementLike | null): boolean {
  return Boolean(target?.closest?.(OVERLAY_SELECTOR))
}
