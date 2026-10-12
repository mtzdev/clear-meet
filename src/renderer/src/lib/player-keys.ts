export type PlayerKeyAction = 'toggle' | 'back' | 'forward'

export interface PlayerKeyContext {
  /** O foco está num campo de texto (input de texto, textarea, select, contenteditable). */
  inTextField: boolean
  /** O foco está dentro de um diálogo, menu ou lista aberta. */
  inOverlay: boolean
  modified: boolean
}

export function playerKeyAction(key: string, context: PlayerKeyContext): PlayerKeyAction | null {
  if (context.inTextField || context.inOverlay || context.modified) return null
  switch (key) {
    case ' ':
    case 'Spacebar':
      return 'toggle'
    case 'ArrowLeft':
      return 'back'
    case 'ArrowRight':
      return 'forward'
    default:
      return null
  }
}

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
