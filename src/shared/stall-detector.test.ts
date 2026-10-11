import { describe, expect, it } from 'vitest'
import { FrameStallDetector } from './stall-detector'

describe('FrameStallDetector', () => {
  it('avisa quando passam mais de 2 s sem quadros e desfaz quando voltam', () => {
    const detector = new FrameStallDetector(0)
    for (let t = 0; t <= 1000; t += 66) detector.onFrame(t)
    expect(detector.check(2500)).toBeNull() // 1,5 s desde o último quadro
    expect(detector.check(3100)).toBe(true) // > 2 s
    expect(detector.check(3600)).toBeNull() // já avisado, sem repetir
    detector.onFrame(4000)
    expect(detector.check(4100)).toBe(false)
    expect(detector.check(4600)).toBeNull()
  })

  it('sem nenhum quadro desde o início também conta como congelado', () => {
    const detector = new FrameStallDetector(1000)
    expect(detector.check(2900)).toBeNull()
    expect(detector.check(3100)).toBe(true)
  })

  it('durante a pausa não avisa, e ao retomar a contagem recomeça', () => {
    const detector = new FrameStallDetector(0)
    detector.onFrame(100)
    expect(detector.check(2500)).toBe(true)
    expect(detector.setPaused(true, 2600)).toBe(false) // o aviso some ao pausar
    expect(detector.check(2700)).toBeNull()
    expect(detector.check(30_000)).toBeNull()
    expect(detector.setPaused(false, 30_000)).toBeNull()
    expect(detector.check(31_500)).toBeNull() // 1,5 s de tolerância depois de retomar
    expect(detector.check(32_100)).toBe(true)
  })

  it('o limite pode ser ajustado', () => {
    const detector = new FrameStallDetector(0, 500)
    expect(detector.check(400)).toBeNull()
    expect(detector.check(600)).toBe(true)
  })
})
