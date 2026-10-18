import { describe, expect, it } from 'vitest'
import {
  canRestartForUpdate,
  IDLE_UPDATE_STATE,
  reduceUpdateState,
  type UpdateEvent,
  type UpdateState
} from './update'

const run = (events: UpdateEvent[], from: UpdateState = IDLE_UPDATE_STATE): UpdateState =>
  events.reduce(reduceUpdateState, from)

describe('reduceUpdateState', () => {
  it('segue checagem, download e pronto', () => {
    expect(run([{ type: 'checking' }])).toEqual({ phase: 'checking', version: null, percent: null })
    expect(run([{ type: 'checking' }, { type: 'available', version: '1.2.0' }])).toEqual({
      phase: 'downloading',
      version: '1.2.0',
      percent: 0
    })
    expect(
      run([
        { type: 'available', version: '1.2.0' },
        { type: 'progress', percent: 41.6 }
      ])
    ).toEqual({ phase: 'downloading', version: '1.2.0', percent: 42 })
    expect(
      run([
        { type: 'available', version: '1.2.0' },
        { type: 'downloaded', version: '1.2.0' }
      ])
    ).toEqual({ phase: 'ready', version: '1.2.0', percent: null })
  })

  it('limita o progresso a 0..100 e ignora progresso fora do download', () => {
    const downloading = run([{ type: 'available', version: '1.2.0' }])
    expect(reduceUpdateState(downloading, { type: 'progress', percent: 250 }).percent).toBe(100)
    expect(reduceUpdateState(downloading, { type: 'progress', percent: -3 }).percent).toBe(0)
    expect(reduceUpdateState(IDLE_UPDATE_STATE, { type: 'progress', percent: 10 })).toBe(
      IDLE_UPDATE_STATE
    )
  })

  it('volta ao repouso sem versão nova ou com erro', () => {
    expect(run([{ type: 'checking' }, { type: 'not-available' }])).toBe(IDLE_UPDATE_STATE)
    expect(run([{ type: 'checking' }, { type: 'error' }])).toBe(IDLE_UPDATE_STATE)
    expect(run([{ type: 'available', version: '1.2.0' }, { type: 'error' }])).toBe(
      IDLE_UPDATE_STATE
    )
  })

  it('não perde a checagem em andamento quando outra começa durante o download', () => {
    const downloading = run([{ type: 'available', version: '1.2.0' }])
    expect(reduceUpdateState(downloading, { type: 'checking' })).toBe(downloading)
  })

  it('mantém a atualização pronta diante de qualquer outro evento', () => {
    const ready = run([{ type: 'downloaded', version: '1.2.0' }])
    for (const event of [
      { type: 'checking' },
      { type: 'not-available' },
      { type: 'error' },
      { type: 'available', version: '1.3.0' }
    ] satisfies UpdateEvent[]) {
      expect(reduceUpdateState(ready, event)).toBe(ready)
    }
    expect(reduceUpdateState(ready, { type: 'downloaded', version: '1.3.0' }).version).toBe('1.3.0')
  })
})

describe('canRestartForUpdate', () => {
  it('só reinicia com a gravação parada', () => {
    expect(canRestartForUpdate('idle')).toBe(true)
    for (const phase of ['starting', 'recording', 'paused', 'finalizing'] as const) {
      expect(canRestartForUpdate(phase)).toBe(false)
    }
  })
})
