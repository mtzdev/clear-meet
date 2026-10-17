import { describe, expect, it } from 'vitest'
import { cleanupCutoffMs, cleanupVerdict, parseCleanupRequest } from './cleanup'
import type { MeetingListItem } from './library'

type Input = Pick<
  MeetingListItem,
  'status' | 'live' | 'transcriptStatus' | 'summaryStatus' | 'compactionStatus' | 'hasVideo'
>

function item(overrides: Partial<Input> = {}): Input {
  return {
    status: 'ready',
    live: false,
    transcriptStatus: 'none',
    summaryStatus: 'none',
    compactionStatus: 'none',
    hasVideo: true,
    ...overrides
  }
}

describe('parseCleanupRequest', () => {
  it('aceita dias inteiros e um modo válido', () => {
    expect(parseCleanupRequest({ olderThanDays: 30, mode: 'video' })).toEqual({
      olderThanDays: 30,
      mode: 'video'
    })
    expect(parseCleanupRequest({ olderThanDays: 90, mode: 'meeting' })).not.toBeNull()
  })

  it('recusa o que não é um pedido da tela', () => {
    for (const raw of [
      null,
      'x',
      {},
      { olderThanDays: 0, mode: 'video' },
      { olderThanDays: -3, mode: 'video' },
      { olderThanDays: 1.5, mode: 'video' },
      { olderThanDays: '30', mode: 'video' },
      { olderThanDays: 99999, mode: 'video' },
      { olderThanDays: 30, mode: 'tudo' },
      { olderThanDays: Number.NaN, mode: 'video' }
    ]) {
      expect(parseCleanupRequest(raw), JSON.stringify(raw)).toBeNull()
    }
  })
})

describe('cleanupCutoffMs', () => {
  it('volta o número de dias a partir de agora', () => {
    const now = Date.parse('2026-10-16T12:00:00.000Z')
    expect(cleanupCutoffMs(now, 30)).toBe(Date.parse('2026-09-16T12:00:00.000Z'))
  })
})

describe('cleanupVerdict', () => {
  it('Reunião pronta e parada é elegível nos dois modos', () => {
    expect(cleanupVerdict(item(), 'video')).toBe('eligible')
    expect(cleanupVerdict(item(), 'meeting')).toBe('eligible')
  })

  it('Só vídeo ignora Reunião sem Vídeo; Reunião inteira não', () => {
    expect(cleanupVerdict(item({ hasVideo: false }), 'video')).toBe('ignore')
    expect(cleanupVerdict(item({ hasVideo: false }), 'meeting')).toBe('eligible')
  })

  it('gravando, não finalizada ou compactando ficam de fora (puladas)', () => {
    for (const mode of ['video', 'meeting'] as const) {
      expect(cleanupVerdict(item({ live: true }), mode)).toBe('busy')
      expect(cleanupVerdict(item({ status: 'recording' }), mode)).toBe('busy')
      expect(cleanupVerdict(item({ status: 'unprocessed' }), mode)).toBe('busy')
      expect(cleanupVerdict(item({ compactionStatus: 'running' }), mode)).toBe('busy')
    }
  })

  it('IA em andamento barra a Reunião inteira, mas não o Só vídeo (a IA lê só o áudio)', () => {
    const transcribing = item({ transcriptStatus: 'running' })
    expect(cleanupVerdict(transcribing, 'meeting')).toBe('busy')
    expect(cleanupVerdict(transcribing, 'video')).toBe('eligible')
    expect(cleanupVerdict(item({ summaryStatus: 'running' }), 'meeting')).toBe('busy')
  })
})
