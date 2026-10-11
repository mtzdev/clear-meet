import { describe, expect, it } from 'vitest'
import {
  clockElapsedMs,
  clockPause,
  clockResume,
  clockStart,
  formatElapsed,
  isClockRunning
} from './clock'

describe('relógio da gravação (Instantes)', () => {
  it('conta o tempo desde o início', () => {
    const clock = clockStart(1_000)
    expect(clockElapsedMs(clock, 1_000)).toBe(0)
    expect(clockElapsedMs(clock, 6_500)).toBe(5_500)
    expect(isClockRunning(clock)).toBe(true)
  })

  it('a pausa congela o tempo e o resume continua de onde parou', () => {
    let clock = clockStart(0)
    clock = clockPause(clock, 10_000)
    expect(isClockRunning(clock)).toBe(false)
    expect(clockElapsedMs(clock, 10_000)).toBe(10_000)
    expect(clockElapsedMs(clock, 99_000)).toBe(10_000)

    clock = clockResume(clock, 60_000)
    expect(clockElapsedMs(clock, 60_000)).toBe(10_000)
    expect(clockElapsedMs(clock, 65_000)).toBe(15_000)
  })

  it('várias pausas acumulam só o tempo gravado', () => {
    let clock = clockStart(0)
    clock = clockPause(clock, 5_000) //  5 s gravados
    clock = clockResume(clock, 8_000)
    clock = clockPause(clock, 11_000) // +3 s = 8 s
    clock = clockResume(clock, 20_000)
    expect(clockElapsedMs(clock, 22_000)).toBe(10_000)
  })

  it('pausar duas vezes ou retomar sem pausa não muda nada', () => {
    const paused = clockPause(clockStart(0), 1_000)
    expect(clockPause(paused, 5_000)).toBe(paused)
    const running = clockStart(0)
    expect(clockResume(running, 5_000)).toBe(running)
  })

  it('nunca fica negativo se os relógios divergem alguns ms', () => {
    const clock = clockStart(10_000)
    expect(clockElapsedMs(clock, 9_990)).toBe(0)
    expect(clockElapsedMs(clockPause(clock, 9_990), 20_000)).toBe(0)
  })
})

describe('formatElapsed', () => {
  it('formata mm:ss e h:mm:ss', () => {
    expect(formatElapsed(0)).toBe('00:00')
    expect(formatElapsed(75_000)).toBe('01:15')
    expect(formatElapsed(59_999)).toBe('00:59')
    expect(formatElapsed(3_675_000)).toBe('1:01:15')
    expect(formatElapsed(-1)).toBe('00:00')
  })
})
