import { describe, expect, it } from 'vitest'
import type { MeetingNote } from '@shared/meeting'
import { TRANSCRIPT_SCHEMA_VERSION, type TranscriptFile } from '@shared/transcript'
import { formatMeetingForAi } from './format'

function transcript(overrides: Partial<TranscriptFile> = {}): TranscriptFile {
  return {
    schemaVersion: TRANSCRIPT_SCHEMA_VERSION,
    model: 'm',
    createdAt: '2026-10-13T10:00:00.000Z',
    durationMs: 3_700_000,
    speakers: [
      { id: 's1', name: 'Ana' },
      { id: 's2', name: null }
    ],
    utterances: [
      { id: 'u1', speakerId: 's1', startMs: 5000, text: 'Bom dia, pessoal.' },
      { id: 'u2', speakerId: 's2', startMs: 65_000, text: 'Bom dia.\nVamos começar?' },
      { id: 'u3', speakerId: 's1', startMs: 3_661_000, text: 'Fechado.' }
    ],
    ...overrides
  }
}

const note = (offsetMs: number, text: string): MeetingNote => ({
  id: `n${offsetMs}`,
  offsetMs,
  text,
  createdAt: '2026-10-13T10:00:00.000Z'
})

describe('formatMeetingForAi', () => {
  it('uma linha por Fala, "[mm:ss] Nome: texto", com "Falante N" quando sem nome', () => {
    const text = formatMeetingForAi(
      { name: 'Planejamento', durationMs: 3_700_000 },
      transcript(),
      []
    )
    expect(text).toBe(
      [
        'Reunião: Planejamento (duração 1:01:40)',
        '',
        '=== TRANSCRIÇÃO ===',
        '[00:05] Ana: Bom dia, pessoal.',
        '[01:05] Falante 2: Bom dia. Vamos começar?',
        '[1:01:01] Ana: Fechado.'
      ].join('\n')
    )
  })

  it('usa os nomes atuais dos Falantes, inclusive os renomeados pelo usuário', () => {
    const renamed = transcript({
      speakers: [
        { id: 's1', name: 'Ana Souza' },
        { id: 's2', name: 'Bruno' }
      ]
    })
    const text = formatMeetingForAi({ name: 'x', durationMs: null }, renamed, [])
    expect(text).toContain('[00:05] Ana Souza: Bom dia, pessoal.')
    expect(text).toContain('[01:05] Bruno: Bom dia. Vamos começar?')
    expect(text).not.toContain('Falante 2')
  })

  it('as Anotações entram à parte, marcadas como do usuário e em ordem de Instante', () => {
    const text = formatMeetingForAi({ name: 'x', durationMs: null }, transcript(), [
      note(90_000, 'Perguntar sobre o prazo'),
      note(10_000, '  Lembrar\ndo orçamento  '),
      note(20_000, '   ')
    ])
    const section = text.slice(text.indexOf('=== ANOTAÇÕES'))
    expect(section).toBe(
      [
        '=== ANOTAÇÕES DO USUÁRIO (escritas por ele; não foram ditas na Reunião) ===',
        '[00:10] Lembrar do orçamento',
        '[01:30] Perguntar sobre o prazo'
      ].join('\n')
    )
  })

  it('sem Anotações não há seção de Anotações', () => {
    expect(formatMeetingForAi({ name: 'x', durationMs: null }, transcript(), [])).not.toContain(
      'ANOTAÇÕES'
    )
  })
})
