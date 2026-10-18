import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RecordingState } from '@shared/recording'
import type { UpdateEvent, UpdateState } from '@shared/update'
import { UpdaterService, type UpdateDriver } from './service'

class FakeDriver implements UpdateDriver {
  listener: (event: UpdateEvent) => void = () => undefined
  checks = 0
  installs = 0
  failNextCheck = false
  subscribe(listener: (event: UpdateEvent) => void): void {
    this.listener = listener
  }
  check(): Promise<void> {
    this.checks++
    if (this.failNextCheck) return Promise.reject(new Error('sem rede'))
    return Promise.resolve()
  }
  quitAndInstall(): void {
    this.installs++
  }
}

let driver: FakeDriver
let phase: RecordingState['phase']
let emitted: UpdateState[]

function create(withDriver = true): UpdaterService {
  return new UpdaterService({
    driver: withDriver ? driver : null,
    recordingPhase: () => phase,
    emit: (state) => emitted.push(state),
    firstCheckDelayMs: 1_000,
    intervalMs: 10_000
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  driver = new FakeDriver()
  phase = 'idle'
  emitted = []
})
afterEach(() => {
  vi.useRealTimers()
})

describe('UpdaterService', () => {
  it('fica indisponível sem driver e não checa', () => {
    const service = create(false)
    service.start()
    vi.advanceTimersByTime(60_000)
    expect(service.getState().phase).toBe('unavailable')
    expect(driver.checks).toBe(0)
    expect(service.restart()).toMatchObject({ ok: false })
  })

  it('checa depois de um atraso e depois a cada intervalo', () => {
    const service = create()
    service.start()
    expect(driver.checks).toBe(0)
    vi.advanceTimersByTime(1_000)
    expect(driver.checks).toBe(1)
    vi.advanceTimersByTime(10_000)
    expect(driver.checks).toBe(2)
    service.stop()
    vi.advanceTimersByTime(60_000)
    expect(driver.checks).toBe(2)
  })

  it('publica as mudanças de estado vindas do atualizador', () => {
    create()
    driver.listener({ type: 'checking' })
    driver.listener({ type: 'available', version: '1.2.0' })
    driver.listener({ type: 'downloaded', version: '1.2.0' })
    expect(emitted.map((state) => state.phase)).toEqual(['checking', 'downloading', 'ready'])
  })

  it('não checa de novo com a atualização baixando ou pronta', async () => {
    const service = create()
    driver.listener({ type: 'available', version: '1.2.0' })
    await service.check()
    driver.listener({ type: 'downloaded', version: '1.2.0' })
    await service.check()
    expect(driver.checks).toBe(0)
  })

  it('trata falha na checagem sem lançar e volta ao repouso', async () => {
    const service = create()
    driver.failNextCheck = true
    await expect(service.check()).resolves.toBeUndefined()
    expect(service.getState().phase).toBe('idle')
  })

  it('só reinicia com a atualização pronta', () => {
    const service = create()
    expect(service.restart()).toMatchObject({ ok: false, error: { code: 'not-found' } })
    expect(driver.installs).toBe(0)
  })

  it('recusa reiniciar durante a gravação e reinicia depois', () => {
    const service = create()
    driver.listener({ type: 'downloaded', version: '1.2.0' })
    for (const busy of ['starting', 'recording', 'paused', 'finalizing'] as const) {
      phase = busy
      expect(service.restart()).toMatchObject({ ok: false, error: { code: 'busy' } })
    }
    expect(driver.installs).toBe(0)
    phase = 'idle'
    expect(service.restart()).toEqual({ ok: true, value: null })
    expect(driver.installs).toBe(1)
  })
})
