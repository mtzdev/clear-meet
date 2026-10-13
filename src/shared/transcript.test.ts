import { describe, expect, it } from 'vitest'
import {
  assignSpeakers,
  currentUtteranceIndex,
  findMatches,
  genericSpeakerNumber,
  labelFor,
  makeTranscriptView,
  NO_TRANSCRIPT,
  parseTranscript,
  parseTranscriptMeta,
  parseTranscriptText,
  renameSpeaker,
  serializeTranscript,
  SPEAKER_COLOR_COUNT,
  speakerColorIndex,
  speakerLabel,
  speakerStats,
  TRANSCRIPT_SCHEMA_VERSION,
  type Speaker,
  type TranscriptFile,
  type Utterance
} from './transcript'

const speakers: Speaker[] = [
  { id: 's1', name: 'Ana' },
  { id: 's2', name: null }
]

const utterances: Utterance[] = [
  { id: 'u1', speakerId: 's1', startMs: 1000, text: 'Bom dia' },
  { id: 'u2', speakerId: 's2', startMs: 5000, text: 'Bom dia, Ana' },
  { id: 'u3', speakerId: 's1', startMs: 9000, text: 'Vamos começar' }
]

const file: TranscriptFile = {
  schemaVersion: TRANSCRIPT_SCHEMA_VERSION,
  model: 'gemini-3.8-flash',
  createdAt: '2026-10-12T10:00:00.000Z',
  durationMs: 60_000,
  speakers,
  utterances
}

describe('parseTranscriptMeta', () => {
  const meta = {
    status: 'running',
    model: 'gemini-3.8-flash',
    updatedAt: '2026-10-12T10:00:00.000Z'
  }

  it('lê o estado e os opcionais', () => {
    expect(parseTranscriptMeta({ ...meta, error: 'x', summaryRequested: true })).toEqual({
      ...meta,
      error: 'x',
      summaryRequested: true
    })
    expect(parseTranscriptMeta(meta)).toEqual(meta)
  })

  it('formato inválido vira ausência', () => {
    expect(parseTranscriptMeta(null)).toBeUndefined()
    expect(parseTranscriptMeta({ ...meta, status: 'quase' })).toBeUndefined()
    expect(parseTranscriptMeta({ ...meta, updatedAt: 'ontem' })).toBeUndefined()
    expect(parseTranscriptMeta({ ...meta, model: 3 })).toBeUndefined()
  })
})

describe('transcript.json', () => {
  it('serializa e lê de volta', () => {
    expect(parseTranscriptText(serializeTranscript(file))).toEqual({ ok: true, value: file })
  })

  it('rejeita JSON inválido, versão desconhecida e Fala malformada', () => {
    expect(parseTranscriptText('{').ok).toBe(false)
    expect(parseTranscript({ ...file, schemaVersion: 99 }).ok).toBe(false)
    expect(parseTranscript({ ...file, utterances: [{ id: 'x', startMs: 0, text: '' }] }).ok).toBe(
      false
    )
    expect(parseTranscript({ ...file, utterances: [{ ...utterances[0], startMs: -1 }] }).ok).toBe(
      false
    )
    // Fala que cita um Falante que não existe, e lista de Falantes inválida.
    expect(
      parseTranscript({ ...file, utterances: [{ ...utterances[0], speakerId: 's9' }] }).ok
    ).toBe(false)
    expect(parseTranscript({ ...file, speakers: [{ id: 's1', name: 3 }] }).ok).toBe(false)
    expect(
      parseTranscript({
        ...file,
        speakers: [
          { id: 's1', name: null },
          { id: 's1', name: 'x' }
        ]
      }).ok
    ).toBe(false)
  })

  it('converte a versão 1 (rótulo em cada Fala) para Falantes com id', () => {
    const v1 = {
      schemaVersion: 1,
      model: 'gemini-3.5-flash-lite',
      createdAt: '2026-10-12T10:00:00.000Z',
      durationMs: 60_000,
      speakers: ['Falante 1', '11:20'],
      utterances: [
        { id: 'u1', speaker: 'Falante 1', startMs: 1000, text: 'a' },
        { id: 'u2', speaker: '11:20', startMs: 2000, text: 'b' },
        { id: 'u3', speaker: 'Falante 1', startMs: 3000, text: 'c' }
      ]
    }
    const parsed = parseTranscript(v1)
    expect(parsed.ok && parsed.value.schemaVersion).toBe(TRANSCRIPT_SCHEMA_VERSION)
    expect(parsed.ok && parsed.value.speakers).toEqual([
      { id: 's1', name: null },
      { id: 's2', name: '11:20' }
    ])
    expect(parsed.ok && parsed.value.utterances.map((u) => u.speakerId)).toEqual(['s1', 's2', 's1'])
  })
})

describe('Falantes', () => {
  it('assignSpeakers: "Falante N" fica com sN e nomes pegam o menor número livre', () => {
    expect(assignSpeakers(['Ana', 'Falante 1', 'Bia', 'Falante 3', 'Ana'])).toEqual([
      { id: 's2', name: 'Ana' },
      { id: 's1', name: null },
      { id: 's4', name: 'Bia' },
      { id: 's3', name: null }
    ])
    expect(genericSpeakerNumber('Falante 12')).toBe(12)
    expect(genericSpeakerNumber('Falante')).toBeNull()
  })

  it('o rótulo é o nome, ou "Falante N" pelo número do id', () => {
    expect(speakerLabel({ id: 's1', name: 'Ana' })).toBe('Ana')
    expect(speakerLabel({ id: 's7', name: null })).toBe('Falante 7')
    expect(labelFor(speakers, 's2')).toBe('Falante 2')
    expect(labelFor(speakers, 'zzz')).toBe('Falante')
  })

  it('renameSpeaker: troca o nome, limpa com texto vazio e recusa duplicados', () => {
    const renamed = renameSpeaker(speakers, 's2', '  Bruno   Lima ')
    expect(renamed).toEqual({
      ok: true,
      speakers: [
        { id: 's1', name: 'Ana' },
        { id: 's2', name: 'Bruno Lima' }
      ]
    })
    expect(renameSpeaker(speakers, 's1', '')).toEqual({
      ok: true,
      speakers: [
        { id: 's1', name: null },
        { id: 's2', name: null }
      ]
    })
    expect(renameSpeaker(speakers, 's2', 'ANA')).toMatchObject({ ok: false })
    expect(renameSpeaker(speakers, 's1', 'Falante 2')).toMatchObject({ ok: false })
    expect(renameSpeaker(speakers, 'zzz', 'X')).toMatchObject({ ok: false })
    // O original não é alterado.
    expect(speakers[1]?.name).toBeNull()
  })

  it('speakerStats: contagem de Falas e tempo de fala (limitado por Fala)', () => {
    const stats = speakerStats(
      speakers,
      [
        { id: 'a', speakerId: 's1', startMs: 0, text: 'x' },
        { id: 'b', speakerId: 's2', startMs: 10_000, text: 'y' },
        { id: 'c', speakerId: 's1', startMs: 20_000, text: 'z' }
      ],
      200_000
    )
    expect(stats).toEqual([
      // s1: 10 s até a próxima + 30 s (limite) até o fim da Reunião.
      { id: 's1', utterances: 2, speakingMs: 40_000 },
      { id: 's2', utterances: 1, speakingMs: 10_000 }
    ])
  })
})

describe('makeTranscriptView', () => {
  it('sem estado = nenhuma Transcrição; com estado inclui o progresso', () => {
    expect(makeTranscriptView(undefined, null)).toBe(NO_TRANSCRIPT)
    expect(
      makeTranscriptView(
        { status: 'running', model: 'm', updatedAt: '2026-10-12T10:00:00.000Z' },
        { done: 1, total: 4 }
      )
    ).toMatchObject({ status: 'running', done: 1, total: 4, error: null, summaryRequested: false })
  })
})

describe('currentUtteranceIndex', () => {
  it('é -1 antes da primeira Fala e a última já iniciada depois', () => {
    expect(currentUtteranceIndex(utterances, 0)).toBe(-1)
    expect(currentUtteranceIndex(utterances, 1000)).toBe(0)
    expect(currentUtteranceIndex(utterances, 4999)).toBe(0)
    expect(currentUtteranceIndex(utterances, 5000)).toBe(1)
    expect(currentUtteranceIndex(utterances, 999_999)).toBe(2)
    expect(currentUtteranceIndex([], 1000)).toBe(-1)
  })
})

describe('speakerColorIndex', () => {
  it('segue a ordem dos Falantes e dá a volta na paleta', () => {
    const many: Speaker[] = Array.from({ length: SPEAKER_COLOR_COUNT + 2 }, (_, i) => ({
      id: `s${i}`,
      name: null
    }))
    expect(speakerColorIndex(many, 's0')).toBe(0)
    expect(speakerColorIndex(many, 's3')).toBe(3)
    expect(speakerColorIndex(many, `s${SPEAKER_COLOR_COUNT}`)).toBe(0)
    expect(speakerColorIndex(many, 'desconhecido')).toBe(0)
  })
})

describe('findMatches', () => {
  it('ignora maiúsculas e acentos e devolve posições do texto original', () => {
    expect(findMatches('Vamos começar a REUNIÃO', 'reuniao')).toEqual([[16, 23]])
    expect(findMatches('começar e comecar', 'comecar')).toEqual([
      [0, 7],
      [10, 17]
    ])
  })

  it('busca vazia ou sem ocorrência não casa nada', () => {
    expect(findMatches('abc', '')).toEqual([])
    expect(findMatches('abc', '   ')).toEqual([])
    expect(findMatches('abc', 'z')).toEqual([])
  })
})
