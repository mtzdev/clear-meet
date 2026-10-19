import { describe, expect, it } from 'vitest'
import {
  baseView,
  clampScale,
  clampView,
  fitRect,
  formatZoom,
  isZoomed,
  MAX_ZOOM,
  panBy,
  toggleZoomAt,
  viewSpace,
  viewTransform,
  wheelFactor,
  zoomAt,
  zoomBy
} from './player-view'

const STAGE = { width: 800, height: 450 }

describe('fitRect', () => {
  it('encaixa o vídeo inteiro, centralizado e na proporção', () => {
    expect(fitRect({ width: 1920, height: 1080 }, STAGE)).toEqual({
      x: 0,
      y: 0,
      width: 800,
      height: 450
    })
    const portrait = fitRect({ width: 360, height: 640 }, STAGE)
    expect(portrait.height).toBeCloseTo(450)
    expect(portrait.width).toBeCloseTo(253.125)
    expect(portrait.x).toBeCloseTo((800 - 253.125) / 2)
    expect(portrait.y).toBeCloseTo(0)
  })

  it('amplia vídeos menores que a área', () => {
    const rect = fitRect({ width: 320, height: 180 }, STAGE)
    expect(rect.width).toBeCloseTo(800)
    expect(rect.height).toBeCloseTo(450)
  })

  it('nunca ultrapassa a área, em qualquer proporção', () => {
    for (const [w, h] of [
      [2560, 1080],
      [640, 360],
      [100, 900],
      [1366, 768]
    ] as const) {
      const rect = fitRect({ width: w, height: h }, STAGE)
      expect(rect.x).toBeGreaterThanOrEqual(0)
      expect(rect.y).toBeGreaterThanOrEqual(0)
      expect(rect.x + rect.width).toBeLessThanOrEqual(STAGE.width + 1e-6)
      expect(rect.y + rect.height).toBeLessThanOrEqual(STAGE.height + 1e-6)
      expect(rect.width / rect.height).toBeCloseTo(w / h)
    }
  })

  it('sem tamanho do vídeo usa a área toda; sem área, nada', () => {
    expect(fitRect({ width: 0, height: 0 }, STAGE)).toEqual({ x: 0, y: 0, ...STAGE })
    expect(fitRect({ width: 100, height: 100 }, { width: 0, height: 0 })).toEqual({
      x: 0,
      y: 0,
      width: 0,
      height: 0
    })
  })
})

const VIDEO_169 = { width: 1920, height: 1080 }
const FIT = viewSpace(VIDEO_169, STAGE, null)
const START = baseView(FIT)

describe('zoom', () => {
  it('sem área, o ajuste é o vídeo inteiro (escala 1, sem deslocamento)', () => {
    expect(START).toEqual({ scale: 1, x: 0, y: 0 })
    expect(FIT.minScale).toBe(1)
  })

  it('limita o nível entre o ajuste e o máximo', () => {
    expect(clampScale(0.2, FIT)).toBe(1)
    expect(clampScale(100, FIT)).toBe(MAX_ZOOM)
    expect(clampScale(Number.NaN, FIT)).toBe(1)
  })

  it('mantém o ponto sob o cursor parado na tela', () => {
    const anchor = { x: 600, y: 100 }
    const view = zoomAt(START, 2, anchor, FIT)
    expect((anchor.x - view.x) / view.scale).toBeCloseTo(600)
    expect((anchor.y - view.y) / view.scale).toBeCloseTo(100)
  })

  it('zoom no centro mantém o centro da imagem no centro da área', () => {
    const view = zoomBy(START, 2, { x: 400, y: 225 }, FIT)
    expect(view.scale).toBe(2)
    expect(view.x).toBeCloseTo(-400)
    expect(view.y).toBeCloseTo(-225)
  })

  it('zoom out até o ajuste volta ao estado inicial', () => {
    const zoomed = zoomAt(START, 3, { x: 700, y: 400 }, FIT)
    expect(zoomBy(zoomed, 0.1, { x: 700, y: 400 }, FIT)).toEqual(START)
  })

  it('não passa do zoom máximo', () => {
    expect(zoomBy(START, 1000, { x: 0, y: 0 }, FIT).scale).toBe(MAX_ZOOM)
  })

  it('duplo clique alterna entre ajuste e 2x no ponto clicado', () => {
    const zoomed = toggleZoomAt(START, { x: 200, y: 100 }, FIT)
    expect(zoomed.scale).toBe(2)
    expect((200 - zoomed.x) / 2).toBeCloseTo(200)
    expect(toggleZoomAt(zoomed, { x: 10, y: 10 }, FIT)).toEqual(START)
  })

  it('isZoomed ignora diferenças desprezíveis', () => {
    expect(isZoomed(START, FIT)).toBe(false)
    expect(isZoomed({ scale: 1.0001, x: 0, y: 0 }, FIT)).toBe(false)
    expect(isZoomed({ scale: 1.25, x: 0, y: 0 }, FIT)).toBe(true)
  })
})

describe('arrasto (pan)', () => {
  it('não deixa a imagem ampliada sair da área', () => {
    const view = { scale: 2, x: -400, y: -225 }
    expect(panBy(view, 5000, 5000, FIT)).toEqual({ scale: 2, x: 0, y: 0 })
    expect(panBy(view, -5000, -5000, FIT)).toEqual({ scale: 2, x: -800, y: -450 })
  })

  it('imagem menor que a área numa direção fica centralizada nela', () => {
    const portrait = viewSpace({ width: 360, height: 640 }, STAGE, null)
    const fit = fitRect({ width: 360, height: 640 }, STAGE)
    const view = clampView({ scale: 1.5, x: 300, y: 0 }, portrait)
    expect(view.x + 1.5 * (fit.x + fit.width / 2)).toBeCloseTo(400)
    expect(view.y).toBeLessThanOrEqual(0)
    expect(view.y + 1.5 * fit.height).toBeGreaterThanOrEqual(450)
  })

  it('no ajuste não há deslocamento', () => {
    expect(clampView({ scale: 1, x: 50, y: 50 }, FIT)).toEqual(START)
    expect(panBy(START, 100, 100, FIT)).toEqual(START)
  })

  it('reencaixa quando a área muda de tamanho', () => {
    const smaller = { width: 400, height: 225 }
    const next = clampView({ scale: 2, x: -800, y: -450 }, viewSpace(VIDEO_169, smaller, null))
    expect(next).toEqual({ scale: 2, x: -400, y: -225 })
  })
})

describe('área útil (vídeo com faixas pretas gravadas)', () => {
  // 1366x768 centralizado num quadro 1920x1080 (com folga de 2 px, medidas pares).
  const area = { x: 276, y: 154, width: 1370, height: 772 }
  const space = viewSpace(VIDEO_169, STAGE, area)

  it('o ajuste amplia para enquadrar só a área útil', () => {
    expect(space.minScale).toBeCloseTo(1080 / 772, 3)
    const base = baseView(space)
    expect(base.scale).toBeGreaterThan(1.3)
    // A área útil ocupa a área do player por inteiro numa das direções e fica centrada.
    const ratio = 800 / 1920
    const left = base.x + base.scale * (area.x * ratio)
    const right = base.x + base.scale * ((area.x + area.width) * ratio)
    expect(left).toBeGreaterThanOrEqual(-1e-6)
    expect(right).toBeLessThanOrEqual(800 + 1e-6)
    expect((left + right) / 2).toBeCloseTo(400)
  })

  it('o zoom parte do ajuste: 100% é a área útil, e não passa do máximo', () => {
    const base = baseView(space)
    expect(formatZoom(base, space)).toBe('100%')
    const zoomed = zoomBy(base, 2, { x: 400, y: 225 }, space)
    expect(formatZoom(zoomed, space)).toBe('200%')
    expect(zoomBy(base, 1 / 4, { x: 0, y: 0 }, space)).toEqual(base)
    expect(zoomBy(base, 1000, { x: 0, y: 0 }, space).scale).toBeCloseTo(space.minScale * MAX_ZOOM)
  })

  it('o arrasto nunca mostra as faixas pretas', () => {
    const base = baseView(space)
    const zoomed = zoomBy(base, 3, { x: 400, y: 225 }, space)
    const farRight = panBy(zoomed, 10_000, 0, space)
    const ratio = 800 / 1920
    expect(farRight.x + zoomed.scale * area.x * ratio).toBeLessThanOrEqual(1e-6)
    const farLeft = panBy(zoomed, -10_000, 0, space)
    expect(farLeft.x + zoomed.scale * (area.x + area.width) * ratio).toBeGreaterThanOrEqual(
      800 - 1e-6
    )
  })

  it('sem área, ou com área igual ao quadro, o ajuste não muda', () => {
    expect(viewSpace(VIDEO_169, STAGE, null).minScale).toBe(1)
    expect(viewSpace(VIDEO_169, STAGE, { x: 0, y: 0, width: 1920, height: 1080 }).minScale).toBe(1)
    expect(viewSpace({ width: 0, height: 0 }, STAGE, area).minScale).toBe(1)
  })
})

describe('apresentação', () => {
  it('roda do mouse: para cima aproxima, para baixo afasta; pinça é mais sensível', () => {
    expect(wheelFactor(-100, false)).toBeGreaterThan(1)
    expect(wheelFactor(100, false)).toBeLessThan(1)
    expect(wheelFactor(0, false)).toBe(1)
    expect(wheelFactor(-10, true)).toBeGreaterThan(wheelFactor(-10, false))
    expect(wheelFactor(Number.NaN, false)).toBe(1)
  })

  it('formata o zoom em porcentagem relativa ao ajuste', () => {
    expect(formatZoom({ scale: 1, x: 0, y: 0 }, FIT)).toBe('100%')
    expect(formatZoom({ scale: 1.5625, x: 0, y: 0 }, FIT)).toBe('156%')
    expect(formatZoom({ scale: 20, x: 0, y: 0 }, FIT)).toBe('800%')
  })

  it('monta a transformação CSS', () => {
    expect(viewTransform({ scale: 2, x: -10, y: 5 })).toBe('translate(-10px, 5px) scale(2)')
  })
})
