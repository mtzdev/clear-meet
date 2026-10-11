import { describe, expect, it } from 'vitest'
import {
  assessDisk,
  DISK_ABORT_BYTES,
  DISK_CRITICAL_BYTES,
  DISK_LOW_BYTES,
  mainWindowCloseAction
} from './recording'

describe('mainWindowCloseAction', () => {
  it('durante a gravação o X só oculta; fora dela (e na finalização) fecha o app', () => {
    expect(mainWindowCloseAction('starting')).toBe('hide')
    expect(mainWindowCloseAction('recording')).toBe('hide')
    expect(mainWindowCloseAction('paused')).toBe('hide')
    expect(mainWindowCloseAction('finalizing')).toBe('close')
    expect(mainWindowCloseAction('idle')).toBe('close')
  })
})

describe('assessDisk', () => {
  it('classifica o espaço livre', () => {
    expect(assessDisk(500 * 1024 ** 3)).toBe('ok')
    expect(assessDisk(DISK_LOW_BYTES)).toBe('ok')
    expect(assessDisk(DISK_LOW_BYTES - 1)).toBe('low')
    expect(assessDisk(DISK_CRITICAL_BYTES)).toBe('low')
    expect(assessDisk(DISK_CRITICAL_BYTES - 1)).toBe('critical')
    expect(assessDisk(0)).toBe('critical')
  })

  it('se não deu para medir, não bloqueia', () => {
    expect(assessDisk(null)).toBe('ok')
  })

  it('o limite de parada de emergência é menor que o de recusar o início', () => {
    expect(DISK_ABORT_BYTES).toBeLessThan(DISK_CRITICAL_BYTES)
    expect(DISK_CRITICAL_BYTES).toBeLessThan(DISK_LOW_BYTES)
  })
})
