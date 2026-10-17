/**
 * Quais janelas valem a pena listar. Telas nunca são filtradas. Funções puras: o `sources.ts`
 * só extrai os dados do `desktopCapturer` e aplica o veredito.
 */

export type RejectReason =
  'own' | 'no-name' | 'overlay' | 'hidden' | 'cloaked' | 'tool-window' | 'empty' | 'tiny' | 'blank'

/** Janelas de sistema, de overlays e avisos passageiros que o Windows lista mas ninguém quer gravar. */
const IGNORED_NAMES = new Set([
  'program manager',
  'windows input experience',
  'microsoft text input application',
  'nova notificação',
  'new notification'
])
const IGNORED_PREFIXES = ['nvidia geforce overlay']

/** Menor lado de uma janela real, em pixels. */
const MIN_WINDOW_SIDE = 40
/** Menor lado da miniatura abaixo do qual a janela é considerada sem tamanho útil. */
const MIN_THUMBNAIL_SIDE = 32
/** Pixel até este brilho (0 a 255) conta como preto. */
const BLACK_LEVEL = 16
/** Variação máxima entre pixels de uma imagem "lisa" (uma cor só). */
const UNIFORM_RANGE = 4

export function isIgnoredWindowName(name: string): boolean {
  const normalized = name.trim().toLowerCase()
  return IGNORED_NAMES.has(normalized) || IGNORED_PREFIXES.some((p) => normalized.startsWith(p))
}

/** Motivos que dispensam a miniatura (dá para decidir só pela lista de janelas). */
export function rejectByIdentity(source: {
  id: string
  kind: 'screen' | 'window'
  name: string
  ownIds: ReadonlySet<string>
}): RejectReason | null {
  if (source.kind === 'screen') return null
  if (source.ownIds.has(source.id)) return 'own'
  if (source.name.trim() === '') return 'no-name'
  if (isIgnoredWindowName(source.name)) return 'overlay'
  return null
}

/** Características de uma janela no Windows (user32/dwmapi). */
export interface WindowTraits {
  /** `IsWindowVisible`: janela minimizada continua visível. */
  visible: boolean
  minimized: boolean
  /** Escondida pelo DWM: app suspenso (UWP) ou em outro desktop virtual. */
  cloaked: boolean
  /** `WS_EX_TOOLWINDOW`. */
  toolWindow: boolean
  /** `WS_EX_NOACTIVATE`: típico de overlays. */
  noActivate: boolean
  /** `WS_EX_APPWINDOW`: força a janela a ter botão na barra de tarefas. */
  appWindow: boolean
  width: number
  height: number
}

/** Motivos que vêm do Windows. Uma janela minimizada não é julgada pelo tamanho (ele vira ~160x28). */
export function rejectByTraits(traits: WindowTraits): RejectReason | null {
  if (!traits.visible) return 'hidden'
  if (traits.cloaked) return 'cloaked'
  if ((traits.toolWindow || traits.noActivate) && !traits.appWindow) return 'tool-window'
  if (!traits.minimized && Math.min(traits.width, traits.height) < MIN_WINDOW_SIDE) return 'tiny'
  return null
}

export interface WindowVerdict {
  reject: RejectReason | null
  minimized: boolean
}

/**
 * Decisão final sobre uma janela. Sem as características do Windows (`traits` nulo) só valem os
 * motivos de identidade: nada é escondido por estar minimizada ou com miniatura vazia. A
 * miniatura vazia ou preta só conta como "falsa" se a janela não estiver minimizada: ela
 * aparece assim justamente porque o Windows não a desenha.
 */
export function judgeWindow(input: {
  id: string
  name: string
  ownIds: ReadonlySet<string>
  traits: WindowTraits | null
  /** `null` = miniatura ainda não capturada. */
  preview: { width: number; height: number; blank: boolean } | null
}): WindowVerdict {
  const minimized = input.traits?.minimized ?? false
  const identity = rejectByIdentity({
    id: input.id,
    kind: 'window',
    name: input.name,
    ownIds: input.ownIds
  })
  if (identity) return { reject: identity, minimized }
  if (!input.traits) return { reject: null, minimized }
  const byTraits = rejectByTraits(input.traits)
  if (byTraits) return { reject: byTraits, minimized }
  if (minimized || !input.preview) return { reject: null, minimized }
  return { reject: rejectByPreview(input.preview), minimized }
}

/** Motivos que dependem da miniatura. */
export function rejectByPreview(preview: {
  width: number
  height: number
  blank: boolean
}): RejectReason | null {
  if (preview.width <= 0 || preview.height <= 0) return 'empty'
  if (Math.min(preview.width, preview.height) < MIN_THUMBNAIL_SIDE) return 'tiny'
  if (preview.blank) return 'blank'
  return null
}

/**
 * `true` se a imagem (BGRA, como o `NativeImage.toBitmap`) é toda preta ou de uma cor só.
 * Varre tudo, mas para no primeiro indício de conteúdo: janela real sai nos primeiros pixels.
 */
export function isBlankBitmap(bitmap: Uint8Array, width: number, height: number): boolean {
  const pixels = Math.min(width * height, Math.floor(bitmap.length / 4))
  if (pixels <= 0) return true
  let minB = 255
  let minG = 255
  let minR = 255
  let maxB = 0
  let maxG = 0
  let maxR = 0
  for (let i = 0; i < pixels; i++) {
    const offset = i * 4
    const b = bitmap[offset]!
    const g = bitmap[offset + 1]!
    const r = bitmap[offset + 2]!
    if (b < minB) minB = b
    if (g < minG) minG = g
    if (r < minR) minR = r
    if (b > maxB) maxB = b
    if (g > maxG) maxG = g
    if (r > maxR) maxR = r
    const brightest = Math.max(maxB, maxG, maxR)
    const range = Math.max(maxB - minB, maxG - minG, maxR - minR)
    if (brightest > BLACK_LEVEL && range > UNIFORM_RANGE) return false
  }
  return true
}
