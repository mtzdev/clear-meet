import { describe, expect, it } from 'vitest'
import {
  isBlankBitmap,
  judgeWindow,
  rejectByIdentity,
  rejectByPreview,
  rejectByTraits,
  type WindowTraits
} from './filter'

function bitmap(width: number, height: number, pixel: (i: number) => [number, number, number]) {
  const data = new Uint8Array(width * height * 4)
  for (let i = 0; i < width * height; i++) {
    const [r, g, b] = pixel(i)
    data.set([b, g, r, 255], i * 4)
  }
  return data
}

const own = new Set(['window:1:0'])
const base = { ownIds: own, kind: 'window' as const }

describe('rejectByIdentity', () => {
  it('nunca filtra telas, mesmo sem nome', () => {
    expect(rejectByIdentity({ ...base, kind: 'screen', id: 'screen:0:0', name: '' })).toBeNull()
    expect(rejectByIdentity({ ...base, kind: 'screen', id: 'window:1:0', name: 'x' })).toBeNull()
  })

  it('descarta as janelas do próprio app e as sem nome', () => {
    expect(rejectByIdentity({ ...base, id: 'window:1:0', name: 'ClearMeet' })).toBe('own')
    expect(rejectByIdentity({ ...base, id: 'window:2:0', name: '   ' })).toBe('no-name')
  })

  it('descarta overlays e janelas de sistema conhecidos, sem diferenciar caixa', () => {
    for (const name of [
      'NVIDIA GeForce Overlay',
      'NVIDIA GeForce Overlay DT',
      'nvidia geforce overlay',
      'Program Manager',
      'Nova notificação',
      ' Windows Input Experience '
    ]) {
      expect(rejectByIdentity({ ...base, id: 'window:2:0', name })).toBe('overlay')
    }
  })

  it('mantém janelas comuns, inclusive com palavras parecidas no nome', () => {
    for (const name of ['Discord', 'Overlay design - Figma', 'Gerenciador de Tarefas']) {
      expect(rejectByIdentity({ ...base, id: 'window:2:0', name })).toBeNull()
    }
  })
})

describe('rejectByPreview', () => {
  it('miniatura vazia ou minúscula', () => {
    expect(rejectByPreview({ width: 0, height: 0, blank: false })).toBe('empty')
    expect(rejectByPreview({ width: 320, height: 12, blank: false })).toBe('tiny')
    expect(rejectByPreview({ width: 8, height: 180, blank: false })).toBe('tiny')
  })

  it('miniatura em branco', () => {
    expect(rejectByPreview({ width: 320, height: 180, blank: true })).toBe('blank')
  })

  it('aceita janela estreita mas com conteúdo', () => {
    expect(rejectByPreview({ width: 126, height: 180, blank: false })).toBeNull()
  })
})

describe('isBlankBitmap', () => {
  it('imagem toda preta ou de uma cor só', () => {
    expect(
      isBlankBitmap(
        bitmap(16, 16, () => [0, 0, 0]),
        16,
        16
      )
    ).toBe(true)
    expect(
      isBlankBitmap(
        bitmap(16, 16, () => [240, 240, 240]),
        16,
        16
      )
    ).toBe(true)
    expect(
      isBlankBitmap(
        bitmap(16, 16, (i) => [i % 2, 0, 0]),
        16,
        16
      )
    ).toBe(true)
  })

  it('quase preta (janela que o Windows não consegue desenhar)', () => {
    expect(
      isBlankBitmap(
        bitmap(16, 16, (i) => [i % 9, i % 5, 0]),
        16,
        16
      )
    ).toBe(true)
  })

  it('um terminal escuro com pouco texto não é tratado como vazio', () => {
    const pixels = bitmap(64, 64, (i) => (i === 3000 ? [200, 200, 200] : [0, 0, 0]))
    expect(isBlankBitmap(pixels, 64, 64)).toBe(false)
  })

  it('imagem com conteúdo', () => {
    expect(
      isBlankBitmap(
        bitmap(16, 16, (i) => [i * 8, 100, 50]),
        16,
        16
      )
    ).toBe(false)
  })

  it('bitmap vazio ou menor que o declarado', () => {
    expect(isBlankBitmap(new Uint8Array(0), 0, 0)).toBe(true)
    expect(isBlankBitmap(new Uint8Array(8), 100, 100)).toBe(true)
  })
})

const normal: WindowTraits = {
  visible: true,
  minimized: false,
  cloaked: false,
  toolWindow: false,
  noActivate: false,
  appWindow: false,
  width: 1280,
  height: 720
}
const preview = { width: 320, height: 180, blank: false }
const judge = (traits: WindowTraits | null, pv: typeof preview | null = preview, name = 'App') =>
  judgeWindow({ id: 'window:2:0', name, ownIds: own, traits, preview: pv })

describe('rejectByTraits', () => {
  it('janela normal passa', () => {
    expect(rejectByTraits(normal)).toBeNull()
  })

  it('invisível, escondida pelo DWM e janelas de ferramenta ou overlay', () => {
    expect(rejectByTraits({ ...normal, visible: false })).toBe('hidden')
    expect(rejectByTraits({ ...normal, cloaked: true })).toBe('cloaked')
    expect(rejectByTraits({ ...normal, toolWindow: true })).toBe('tool-window')
    expect(rejectByTraits({ ...normal, noActivate: true })).toBe('tool-window')
  })

  it('WS_EX_APPWINDOW desfaz o estilo de ferramenta', () => {
    expect(rejectByTraits({ ...normal, toolWindow: true, appWindow: true })).toBeNull()
  })

  it('tamanho desprezível, exceto minimizada (o Windows reporta ~160x28)', () => {
    expect(rejectByTraits({ ...normal, width: 1, height: 1 })).toBe('tiny')
    expect(rejectByTraits({ ...normal, width: 800, height: 20 })).toBe('tiny')
    expect(rejectByTraits({ ...normal, minimized: true, width: 160, height: 28 })).toBeNull()
  })
})

describe('judgeWindow', () => {
  it('janela comum fica', () => {
    expect(judge(normal)).toEqual({ reject: null, minimized: false })
  })

  it('minimizada com miniatura vazia ou preta continua na lista e é marcada', () => {
    const minimized = { ...normal, minimized: true, width: 160, height: 28 }
    expect(judge(minimized, { width: 0, height: 0, blank: false })).toEqual({
      reject: null,
      minimized: true
    })
    expect(judge(minimized, { ...preview, blank: true })).toEqual({ reject: null, minimized: true })
  })

  it('não minimizada com miniatura vazia, preta ou minúscula sai', () => {
    expect(judge(normal, { width: 0, height: 0, blank: false }).reject).toBe('empty')
    expect(judge(normal, { ...preview, blank: true }).reject).toBe('blank')
    expect(judge(normal, { width: 300, height: 10, blank: false }).reject).toBe('tiny')
  })

  it('sem miniatura ainda, só as características do Windows decidem', () => {
    expect(judge(normal, null).reject).toBeNull()
    expect(judge({ ...normal, cloaked: true }, null).reject).toBe('cloaked')
  })

  it('minimizada com nome de overlay ou do próprio app sai mesmo assim', () => {
    const minimized = { ...normal, minimized: true }
    expect(judge(minimized, null, 'NVIDIA GeForce Overlay').reject).toBe('overlay')
    expect(
      judgeWindow({
        id: 'window:1:0',
        name: 'ClearMeet',
        ownIds: own,
        traits: minimized,
        preview: null
      }).reject
    ).toBe('own')
  })

  it('sem o Windows (traits nulo) nada é escondido por miniatura ou por minimização', () => {
    expect(judge(null, { width: 0, height: 0, blank: false })).toEqual({
      reject: null,
      minimized: false
    })
    expect(judge(null, { ...preview, blank: true }).reject).toBeNull()
    expect(judge(null, preview, 'NVIDIA GeForce Overlay').reject).toBe('overlay')
  })
})
