/**
 * Atalhos globais no formato de acelerador do Electron (`Ctrl+Shift+Space`): captura a partir
 * de um evento de teclado, validação e texto para exibir. Lógica pura, sem DOM nem Electron.
 */

/** Campos do `KeyboardEvent` que importam para montar o atalho. */
export interface ShortcutKeyEvent {
  code: string
  ctrlKey: boolean
  altKey: boolean
  shiftKey: boolean
  metaKey: boolean
}

export type ShortcutCapture =
  /** Só modificadores apertados até agora: espera a tecla. */
  | { kind: 'pending'; modifiers: string[] }
  | { kind: 'invalid'; message: string }
  | { kind: 'ok'; accelerator: string }

const MODIFIER_CODES = new Set([
  'ControlLeft',
  'ControlRight',
  'ShiftLeft',
  'ShiftRight',
  'AltLeft',
  'AltRight',
  'MetaLeft',
  'MetaRight'
])

const NAMED_KEYS: Record<string, string> = {
  Space: 'Space',
  Enter: 'Enter',
  NumpadEnter: 'Enter',
  Backspace: 'Backspace',
  Delete: 'Delete',
  Insert: 'Insert',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  Tab: 'Tab',
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Semicolon: ';',
  Quote: "'",
  Comma: ',',
  Period: '.',
  Slash: '/',
  Backslash: '\\',
  Backquote: '`'
}

const FIXED_KEYS = new Set([...Object.values(NAMED_KEYS), 'Plus'])

/** Tecla do acelerador para um `KeyboardEvent.code`; `null` se não dá para usar. */
export function keyFromCode(code: string): string | null {
  const letter = /^Key([A-Z])$/.exec(code)
  if (letter) return letter[1] ?? null
  const digit = /^Digit([0-9])$/.exec(code)
  if (digit) return digit[1] ?? null
  const numpad = /^Numpad([0-9])$/.exec(code)
  if (numpad) return `num${numpad[1]}`
  const fn = /^F([1-9]|1[0-9]|2[0-4])$/.exec(code)
  if (fn) return `F${fn[1]}`
  return NAMED_KEYS[code] ?? null
}

const MODIFIER_ORDER = ['Ctrl', 'Alt', 'Shift', 'Super'] as const
type Modifier = (typeof MODIFIER_ORDER)[number]

const MODIFIER_ALIASES: Record<string, Modifier> = {
  ctrl: 'Ctrl',
  control: 'Ctrl',
  commandorcontrol: 'Ctrl',
  cmdorctrl: 'Ctrl',
  alt: 'Alt',
  option: 'Alt',
  shift: 'Shift',
  super: 'Super',
  meta: 'Super',
  win: 'Super'
}

function isKeyName(key: string): boolean {
  return (
    /^[A-Z0-9]$/.test(key) ||
    /^F([1-9]|1[0-9]|2[0-4])$/.test(key) ||
    /^num[0-9]$/.test(key) ||
    FIXED_KEYS.has(key)
  )
}

function isFunctionKey(key: string): boolean {
  return /^F([1-9]|1[0-9]|2[0-4])$/.test(key)
}

const NEEDS_MODIFIER = 'Use pelo menos uma tecla modificadora (Ctrl, Alt ou Win) junto com a tecla.'
const SHIFT_ONLY = 'Shift sozinho atrapalha a digitação: combine com Ctrl, Alt ou Win.'

function checkCombination(modifiers: readonly Modifier[], key: string): string | null {
  if (modifiers.length === 0) return NEEDS_MODIFIER
  const onlyShift = modifiers.length === 1 && modifiers[0] === 'Shift'
  if (onlyShift && !isFunctionKey(key)) return SHIFT_ONLY
  return null
}

function build(modifiers: readonly Modifier[], key: string): string {
  const ordered = MODIFIER_ORDER.filter((modifier) => modifiers.includes(modifier))
  return [...ordered, key].join('+')
}

/** Converte o evento de teclado em atalho; só devolve `ok` com modificador e tecla válidos. */
export function captureShortcut(event: ShortcutKeyEvent): ShortcutCapture {
  const modifiers: Modifier[] = []
  if (event.ctrlKey) modifiers.push('Ctrl')
  if (event.altKey) modifiers.push('Alt')
  if (event.shiftKey) modifiers.push('Shift')
  if (event.metaKey) modifiers.push('Super')

  if (MODIFIER_CODES.has(event.code)) return { kind: 'pending', modifiers }

  const key = keyFromCode(event.code)
  if (key === null) return { kind: 'invalid', message: 'Esta tecla não pode ser usada em atalhos.' }
  const problem = checkCombination(modifiers, key)
  if (problem) return { kind: 'invalid', message: problem }
  return { kind: 'ok', accelerator: build(modifiers, key) }
}

/**
 * Confere um acelerador escrito (do `settings.json` ou da UI) e o devolve normalizado
 * (`CommandOrControl+shift+n` -> `Ctrl+Shift+N`), ou `null` se for inválido.
 */
export function normalizeAccelerator(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const parts = value.split('+').map((part) => part.trim())
  // "Ctrl++" quer dizer Ctrl e a tecla "+": o último pedaço vazio vira "Plus".
  if (parts.length >= 2 && parts[parts.length - 1] === '' && parts[parts.length - 2] === '') {
    parts.splice(parts.length - 2, 2, 'Plus')
  }
  if (parts.length < 2 || parts.some((part) => part === '')) return null
  const rawKey = parts[parts.length - 1] as string
  const modifiers: Modifier[] = []
  for (const raw of parts.slice(0, -1)) {
    const modifier = MODIFIER_ALIASES[raw.toLowerCase()]
    if (!modifier) return null
    if (!modifiers.includes(modifier)) modifiers.push(modifier)
  }
  const key = canonicalKey(rawKey)
  if (key === null) return null
  if (checkCombination(modifiers, key)) return null
  return build(modifiers, key)
}

function canonicalKey(raw: string): string | null {
  if (raw.length === 1) {
    const upper = raw.toUpperCase()
    if (isKeyName(upper)) return upper
    return isKeyName(raw) ? raw : null
  }
  const lower = raw.toLowerCase()
  if (lower === 'esc' || lower === 'escape') return null
  if (lower === 'return') return 'Enter'
  const match = [...FIXED_KEYS].find((name) => name.toLowerCase() === lower)
  if (match) return match
  const fn = /^f([1-9]|1[0-9]|2[0-4])$/.exec(lower)
  if (fn) return `F${fn[1]}`
  const numpad = /^num([0-9])$/.exec(lower)
  if (numpad) return `num${numpad[1]}`
  return null
}

const KEY_LABEL: Record<string, string> = {
  Space: 'Espaço',
  Super: 'Win',
  Up: '↑',
  Down: '↓',
  Left: '←',
  Right: '→',
  Backspace: 'Backspace',
  Delete: 'Delete',
  Plus: '+'
}

/** Texto para mostrar ao usuário: `Ctrl + Shift + Espaço`. */
export function formatAccelerator(accelerator: string): string {
  return accelerator
    .split('+')
    .map((part) => KEY_LABEL[part] ?? part.replace(/^num(\d)$/, 'Num $1'))
    .join(' + ')
}

/** Rótulos dos modificadores já apertados, para o campo de captura enquanto espera a tecla. */
export function formatModifiers(modifiers: readonly string[]): string {
  return modifiers.map((modifier) => KEY_LABEL[modifier] ?? modifier).join(' + ')
}
