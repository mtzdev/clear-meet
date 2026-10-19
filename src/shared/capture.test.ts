import { describe, expect, it } from 'vitest'
import {
  captureMaxSize,
  computeFit,
  FrameRateLimiter,
  isQualityPreset,
  NATIVE_MAX,
  resolveCanvasSize,
  videoBitrate
} from './capture'

describe('resolveCanvasSize', () => {
  it('presets têm tamanho fixo, qualquer que seja a fonte', () => {
    expect(resolveCanvasSize('720p', { width: 3840, height: 2160 })).toEqual({
      width: 1280,
      height: 720
    })
    expect(resolveCanvasSize('1080p', { width: 640, height: 480 })).toEqual({
      width: 1920,
      height: 1080
    })
    expect(resolveCanvasSize('1080p', null)).toEqual({ width: 1920, height: 1080 })
  })

  it('nativa usa o tamanho da fonte, par', () => {
    expect(resolveCanvasSize('native', { width: 2560, height: 1440 })).toEqual({
      width: 2560,
      height: 1440
    })
    expect(resolveCanvasSize('native', { width: 1921, height: 1033 })).toEqual({
      width: 1920,
      height: 1032
    })
  })

  it('nativa acima de 4K é reduzida mantendo a proporção', () => {
    expect(resolveCanvasSize('native', { width: 7680, height: 4320 })).toEqual({
      width: 3840,
      height: 2160
    })
    const ultrawide = resolveCanvasSize('native', { width: 5120, height: 2160 })
    expect(ultrawide.width).toBeLessThanOrEqual(NATIVE_MAX.width)
    expect(ultrawide.height).toBeLessThanOrEqual(NATIVE_MAX.height)
    expect(ultrawide.width / ultrawide.height).toBeCloseTo(5120 / 2160, 2)
  })

  it('nativa sem tamanho conhecido cai em 1080p', () => {
    expect(resolveCanvasSize('native', null)).toEqual({ width: 1920, height: 1080 })
    expect(resolveCanvasSize('native', { width: 0, height: 0 })).toEqual({
      width: 1920,
      height: 1080
    })
  })

  it('a captura pede no máximo o tamanho do preset (ou 4K na nativa)', () => {
    expect(captureMaxSize('720p')).toEqual({ width: 1280, height: 720 })
    expect(captureMaxSize('native')).toEqual(NATIVE_MAX)
  })
})

describe('computeFit', () => {
  const canvas = { width: 1920, height: 1080 }

  it('fonte do mesmo tamanho ocupa o canvas inteiro', () => {
    expect(computeFit(canvas, canvas)).toEqual({ x: 0, y: 0, width: 1920, height: 1080 })
  })

  it('fonte maior é reduzida mantendo a proporção', () => {
    expect(computeFit({ width: 3840, height: 2160 }, canvas)).toEqual({
      x: 0,
      y: 0,
      width: 1920,
      height: 1080
    })
  })

  it('fonte com proporção diferente ganha faixas pretas (letterbox)', () => {
    // 4:3 em 16:9: faixas dos lados.
    expect(computeFit({ width: 1440, height: 1080 }, canvas)).toEqual({
      x: 240,
      y: 0,
      width: 1440,
      height: 1080
    })
    // Janela mais alta que larga, maior que o canvas: reduz e centraliza.
    const fit = computeFit({ width: 1000, height: 2000 }, canvas)
    expect(fit.height).toBe(1080)
    expect(fit.width).toBe(540)
    expect(fit.x).toBe((1920 - 540) / 2)
  })

  it('nunca amplia uma fonte menor que o canvas', () => {
    expect(computeFit({ width: 800, height: 600 }, canvas)).toEqual({
      x: 560,
      y: 240,
      width: 800,
      height: 600
    })
  })

  it('tamanho de fonte inválido preenche o canvas sem dividir por zero', () => {
    expect(computeFit({ width: 0, height: 0 }, canvas)).toEqual({
      x: 0,
      y: 0,
      width: 1920,
      height: 1080
    })
  })

  it('o resultado sempre cabe no canvas', () => {
    for (const [w, h] of [
      [1, 1],
      [5000, 100],
      [100, 5000],
      [1280, 688],
      [1921, 1033]
    ] as const) {
      const fit = computeFit({ width: w, height: h }, canvas)
      expect(fit.x).toBeGreaterThanOrEqual(0)
      expect(fit.y).toBeGreaterThanOrEqual(0)
      expect(fit.x + fit.width).toBeLessThanOrEqual(canvas.width)
      expect(fit.y + fit.height).toBeLessThanOrEqual(canvas.height)
    }
  })
})

describe('videoBitrate', () => {
  const hd = { width: 1920, height: 1080 }
  const sd = { width: 1280, height: 720 }

  it('Compactação ligada grava com folga', () => {
    expect(videoBitrate('1080p', hd, true)).toBe(4_000_000)
    expect(videoBitrate('720p', sd, true)).toBe(2_000_000)
  })

  it('Compactação desligada grava com bitrate moderado', () => {
    expect(videoBitrate('1080p', hd, false)).toBe(2_000_000)
    expect(videoBitrate('720p', sd, false)).toBe(1_000_000)
  })

  it('nativa escala com os pixels e fica entre 1 e 12 Mbps', () => {
    expect(videoBitrate('native', hd, true)).toBe(4_000_000)
    expect(videoBitrate('native', { width: 3840, height: 2160 }, true)).toBe(12_000_000)
    expect(videoBitrate('native', { width: 3840, height: 2160 }, false)).toBe(8_000_000)
    expect(videoBitrate('native', { width: 640, height: 360 }, false)).toBe(1_000_000)
  })
})

describe('isQualityPreset', () => {
  it('aceita só os três presets', () => {
    expect(isQualityPreset('1080p')).toBe(true)
    expect(isQualityPreset('native')).toBe(true)
    expect(isQualityPreset('4k')).toBe(false)
    expect(isQualityPreset(1080)).toBe(false)
  })
})

describe('FrameRateLimiter', () => {
  const interval = 1e6 / 15

  const accepted = (limiter: FrameRateLimiter, timestamps: number[]): number =>
    timestamps.filter((timestamp) => limiter.accept(timestamp)).length

  it('reduz uma fonte de 60 fps para ~15 fps', () => {
    const frames = Array.from({ length: 600 }, (_, index) => index * (1e6 / 60)) // 10 s
    const count = accepted(new FrameRateLimiter(15), frames)
    expect(count).toBeGreaterThanOrEqual(148)
    expect(count).toBeLessThanOrEqual(152)
  })

  it('mantém quase todos os quadros de uma fonte a ~15 fps com jitter', () => {
    const limiter = new FrameRateLimiter(15)
    let t = 0
    const frames: number[] = []
    for (let index = 0; index < 300; index++) {
      t += interval * (index % 2 === 0 ? 0.8 : 1.2) // 53 ms / 80 ms alternados
      frames.push(t)
    }
    expect(accepted(limiter, frames)).toBeGreaterThanOrEqual(285)
  })

  it('depois de uma lacuna (janela minimizada) aceita o primeiro quadro que volta', () => {
    const limiter = new FrameRateLimiter(15)
    expect(limiter.accept(0)).toBe(true)
    expect(limiter.accept(interval)).toBe(true)
    // 12 s sem quadros...
    expect(limiter.accept(12_000_000)).toBe(true)
    expect(limiter.accept(12_000_000 + 10_000)).toBe(false)
    expect(limiter.accept(12_000_000 + interval)).toBe(true)
  })
})
