import { describe, expect, it } from 'vitest'
import { VideoEncoderWatchdog } from './video-watchdog'

/** Alimenta o canvas a 15 quadros por segundo entre `from` e `to` (ms). */
function feed(watchdog: VideoEncoderWatchdog, from: number, to: number): void {
  for (let t = from; t <= to; t += 66) watchdog.onFeed(t)
}

describe('VideoEncoderWatchdog', () => {
  it('gravação saudável (bytes a cada ~7 s) nunca dispara', () => {
    const watchdog = new VideoEncoderWatchdog(0)
    for (let t = 0; t <= 120_000; t += 1000) {
      watchdog.onFeed(t)
      if (t % 7000 === 0) watchdog.onData(t)
      expect(watchdog.check(t)).toBeNull()
    }
  })

  it('quadros entrando mas nenhum byte por mais de 20 s: avisa uma vez; avisa de novo se voltar', () => {
    const watchdog = new VideoEncoderWatchdog(0)
    watchdog.onData(7000)
    feed(watchdog, 7000, 40_000)
    expect(watchdog.check(26_000)).toBeNull()
    expect(watchdog.check(28_000)).toBe(true)
    expect(watchdog.check(30_000)).toBeNull()
    watchdog.onData(31_000)
    expect(watchdog.check(32_000)).toBe(false)
  })

  it('sem quadros (janela minimizada) a falta de bytes é esperada e não dispara', () => {
    const watchdog = new VideoEncoderWatchdog(0)
    watchdog.onData(5000)
    feed(watchdog, 5000, 10_000)
    expect(watchdog.check(40_000)).toBeNull()
  })

  it('lacuna longa sem quadros (tela parada) e um quadro novo: não dispara (cenário real)', () => {
    const watchdog = new VideoEncoderWatchdog(0)
    watchdog.onData(7000)
    feed(watchdog, 0, 1000)
    // Janela parada por 36 s: nenhum quadro, nenhum byte. Depois chega um quadro.
    watchdog.onFeed(37_000)
    expect(watchdog.check(37_700)).toBeNull()
    expect(watchdog.check(39_000)).toBeNull()
    // Voltando a alimentar sem bytes por mais de 20 s depois disso, aí sim dispara.
    feed(watchdog, 37_000, 58_000)
    expect(watchdog.check(56_000)).toBeNull()
    expect(watchdog.check(58_000)).toBe(true)
  })

  it('alimentação contínua sem nenhum byte por mais de 20 s dispara', () => {
    const watchdog = new VideoEncoderWatchdog(0)
    feed(watchdog, 0, 25_000)
    expect(watchdog.check(19_000)).toBeNull()
    expect(watchdog.check(21_000)).toBe(true)
  })

  it('pausa não dispara; ao retomar, a contagem recomeça e o aviso ativo é desfeito', () => {
    const watchdog = new VideoEncoderWatchdog(0)
    watchdog.onData(1000)
    feed(watchdog, 1000, 30_000)
    expect(watchdog.check(30_000)).toBe(true)
    expect(watchdog.setPaused(true, 30_100)).toBe(false)
    expect(watchdog.check(90_000)).toBeNull()
    expect(watchdog.setPaused(false, 90_000)).toBeNull()
    feed(watchdog, 90_000, 100_000)
    expect(watchdog.check(100_000)).toBeNull()
    feed(watchdog, 100_000, 111_000)
    expect(watchdog.check(111_000)).toBe(true)
  })

  it('o limite pode ser ajustado', () => {
    const watchdog = new VideoEncoderWatchdog(0, 2000)
    feed(watchdog, 0, 4000)
    expect(watchdog.check(3000)).toBe(true)
  })
})
