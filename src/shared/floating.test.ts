import { describe, expect, it } from 'vitest'
import {
  BAR_MAX_HEIGHT,
  BAR_SIZE,
  BAR_TOP_MARGIN,
  clampBarHeight,
  clampIntoArea,
  defaultBarPosition,
  NOTE_GAP,
  NOTE_WINDOW_SIZE,
  pickWorkArea,
  placeNoteWindow,
  resolveBarPosition,
  type Rect
} from './floating'

const primary: Rect = { x: 0, y: 0, width: 1920, height: 1040 }
const second: Rect = { x: 1920, y: 0, width: 1280, height: 1000 }
const left: Rect = { x: -1280, y: 100, width: 1280, height: 900 }

describe('defaultBarPosition', () => {
  it('topo-centro do monitor principal', () => {
    expect(defaultBarPosition(primary)).toEqual({
      x: (1920 - BAR_SIZE.width) / 2,
      y: BAR_TOP_MARGIN
    })
  })

  it('respeita a origem da área útil (barra de tarefas no topo, monitor deslocado)', () => {
    expect(defaultBarPosition({ x: 100, y: 40, width: 1000, height: 700 })).toEqual({
      x: Math.round(100 + (1000 - BAR_SIZE.width) / 2),
      y: 40 + BAR_TOP_MARGIN
    })
  })
})

describe('resolveBarPosition', () => {
  it('sem posição salva: topo-centro do principal', () => {
    expect(resolveBarPosition(null, [primary, second], primary)).toEqual(
      defaultBarPosition(primary)
    )
  })

  it('posição salva que ainda cabe é mantida (inclusive em outro monitor)', () => {
    expect(resolveBarPosition({ x: 300, y: 500 }, [primary, second], primary)).toEqual({
      x: 300,
      y: 500
    })
    expect(resolveBarPosition({ x: 2000, y: 200 }, [primary, second], primary)).toEqual({
      x: 2000,
      y: 200
    })
  })

  it('monitor desconectado: volta ao padrão do principal', () => {
    expect(resolveBarPosition({ x: 2000, y: 200 }, [primary], primary)).toEqual(
      defaultBarPosition(primary)
    )
    expect(resolveBarPosition({ x: -900, y: 300 }, [primary, second], primary)).toEqual(
      defaultBarPosition(primary)
    )
  })

  it('monitor à esquerda com coordenadas negativas funciona', () => {
    expect(resolveBarPosition({ x: -800, y: 300 }, [left, primary], primary)).toEqual({
      x: -800,
      y: 300
    })
  })

  it('barra que passa da borda é puxada para dentro do monitor onde está o centro', () => {
    // Centro em x = 3100 + 186 = 3286 -> fora do monitor 2 (termina em 3200): padrão.
    expect(resolveBarPosition({ x: 3100, y: 990 }, [primary, second], primary)).toEqual(
      defaultBarPosition(primary)
    )
    // Centro dentro do monitor 2, mas a barra passa da borda direita e do rodapé.
    const fixed = resolveBarPosition({ x: 2950, y: 960 }, [primary, second], primary)
    expect(fixed).toEqual({ x: 3200 - BAR_SIZE.width, y: 1000 - BAR_SIZE.height })
  })
})

describe('clampIntoArea', () => {
  it('mantém dentro; se o retângulo é maior que a área, vale o canto da área', () => {
    expect(clampIntoArea({ x: -50, y: 2000 }, { width: 100, height: 100 }, primary)).toEqual({
      x: 0,
      y: 940
    })
    expect(clampIntoArea({ x: 500, y: 500 }, { width: 3000, height: 100 }, primary).x).toBe(0)
  })
})

describe('placeNoteWindow', () => {
  const bar: Rect = { x: 774, y: 10, ...BAR_SIZE }

  it('abre abaixo da barra, centralizada nela', () => {
    const position = placeNoteWindow(bar, NOTE_WINDOW_SIZE, primary)
    expect(position.y).toBe(bar.y + bar.height + NOTE_GAP)
    expect(position.x).toBe(Math.round(bar.x + (bar.width - NOTE_WINDOW_SIZE.width) / 2))
  })

  it('sem espaço embaixo (barra no rodapé), abre acima', () => {
    const low: Rect = { ...bar, y: 980 }
    const position = placeNoteWindow(low, NOTE_WINDOW_SIZE, primary)
    expect(position.y).toBe(low.y - NOTE_GAP - NOTE_WINDOW_SIZE.height)
  })

  it('barra encostada na lateral: o campo não sai da tela', () => {
    const edge: Rect = { ...bar, x: 0 }
    expect(placeNoteWindow(edge, NOTE_WINDOW_SIZE, primary).x).toBe(0)
    const right: Rect = { ...bar, x: 1920 - BAR_SIZE.width }
    expect(placeNoteWindow(right, NOTE_WINDOW_SIZE, primary).x).toBe(1920 - NOTE_WINDOW_SIZE.width)
  })
})

describe('pickWorkArea', () => {
  it('o monitor do centro da barra; na falta, o principal', () => {
    expect(pickWorkArea({ x: 2100, y: 50, ...BAR_SIZE }, [primary, second], primary)).toBe(second)
    expect(pickWorkArea({ x: 9000, y: 50, ...BAR_SIZE }, [primary, second], primary)).toBe(primary)
  })
})

describe('clampBarHeight', () => {
  it('limita ao intervalo e ignora lixo', () => {
    expect(clampBarHeight(80.4)).toBe(80)
    expect(clampBarHeight(10)).toBe(BAR_SIZE.height)
    expect(clampBarHeight(5000)).toBe(BAR_MAX_HEIGHT)
    expect(clampBarHeight(Number.NaN)).toBe(BAR_SIZE.height)
    expect(clampBarHeight('80')).toBe(BAR_SIZE.height)
    expect(clampBarHeight(undefined)).toBe(BAR_SIZE.height)
  })
})
