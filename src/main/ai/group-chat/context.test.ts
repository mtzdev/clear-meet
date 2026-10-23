import { describe, expect, it } from 'vitest'
import type { MeetingRelevance } from '@shared/group-chat'
import { SUMMARY_SCHEMA_VERSION, type SummaryFile } from '@shared/summary'
import { TRANSCRIPT_SCHEMA_VERSION, type TranscriptFile } from '@shared/transcript'
import {
  buildGroupContext,
  CONTEXT_BUDGET_CHARS,
  estimateTokens,
  relevanceQuery,
  type ContextMeeting
} from './context'

function transcript(topic: string, lines = 40): TranscriptFile {
  return {
    schemaVersion: TRANSCRIPT_SCHEMA_VERSION,
    model: 'm',
    createdAt: '2026-10-13T12:20:00.000Z',
    durationMs: 3_600_000,
    speakers: [
      { id: 's1', name: 'Ana' },
      { id: 's2', name: null }
    ],
    utterances: Array.from({ length: lines }, (_, index) => ({
      id: `u${index}`,
      speakerId: index % 2 === 0 ? 's1' : 's2',
      startMs: index * 60_000,
      text: `${topic} fala número ${index} com algum texto de preenchimento para ocupar espaço.`
    }))
  }
}

function summary(overview: string): SummaryFile {
  return {
    schemaVersion: SUMMARY_SCHEMA_VERSION,
    provider: 'groq',
    model: 'm',
    createdAt: '2026-10-13T12:30:00.000Z',
    overview,
    keyPoints: [{ text: 'Ponto chave', at: [65_000] }],
    decisions: [{ text: 'Adiar o lançamento', at: [125_000] }],
    actions: [{ owner: 'Ana', task: 'Revisar o contrato', due: 'sexta', at: [] }]
  }
}

function meeting(
  label: number,
  day: number,
  overrides: Partial<ContextMeeting> = {}
): ContextMeeting {
  return {
    id: `m${label}`,
    label,
    name: `Reunião ${label}`,
    createdAt: new Date(Date.UTC(2026, 9, day, 13, 0)).toISOString(),
    durationMs: 3_600_000,
    transcript: transcript(`tema${label}`),
    summary: summary(`Visão geral ${label}`),
    notes: [],
    ...overrides
  }
}

const none = new Map<string, MeetingRelevance>()

describe('buildGroupContext', () => {
  it('cabendo no orçamento, todas levam a Transcrição inteira, em ordem cronológica', () => {
    const built = buildGroupContext([meeting(2, 20), meeting(1, 10)], none)
    expect(built.refs.map((ref) => [ref.label, ref.level])).toEqual([
      [1, 'full'],
      [2, 'full']
    ])
    expect(built.text.indexOf('R1 · Reunião 1')).toBeLessThan(built.text.indexOf('R2 · Reunião 2'))
    expect(built.text).toContain('[00:00] Ana: tema1 fala número 0')
    expect(built.text).toContain('[01:00] Falante 2: tema1 fala número 1')
  })

  it('o cabeçalho traz rótulo, nome e data; o Resumo cita os Instantes com o rótulo', () => {
    const built = buildGroupContext([meeting(3, 14)], none)
    expect(built.text).toMatch(
      /=== R3 · Reunião 3 · 14\/10\/2026 \d{2}:\d{2} \(duração 1:00:00\) ===/
    )
    expect(built.text).toContain('RESUMO:')
    expect(built.text).toContain('- Adiar o lançamento [R3 02:05]')
    expect(built.text).toContain('- Ana: Revisar o contrato (prazo: sexta)')
  })

  it('inclui as Anotações do usuário marcadas como não ditas', () => {
    const built = buildGroupContext(
      [
        meeting(1, 10, {
          notes: [
            { id: 'n', offsetMs: 90_000, text: 'Perguntar ao jurídico', createdAt: 'x' }
          ] as never
        })
      ],
      none
    )
    expect(built.text).toContain('ANOTAÇÕES DO USUÁRIO')
    expect(built.text).toContain('[01:30] Perguntar ao jurídico')
  })

  it('estourando o orçamento, a Transcrição inteira vai para as mais relevantes', () => {
    const list = [meeting(1, 10), meeting(2, 11), meeting(3, 12)]
    const relevance = new Map<string, MeetingRelevance>([
      ['m1', { score: 1, offsets: [] }],
      ['m2', { score: 9, offsets: [] }]
    ])
    const one = buildGroupContext([list[1] as ContextMeeting], none).chars
    const built = buildGroupContext(list, relevance, Math.floor(one * 1.6))
    const level = (label: number) => built.refs.find((ref) => ref.label === label)?.level
    expect(level(2)).toBe('full')
    expect(level(1)).not.toBe('full')
    expect(level(3)).not.toBe('full')
    expect(built.chars).toBeLessThanOrEqual(Math.floor(one * 1.6))
  })

  it('sem relevância conhecida, as mais recentes têm preferência', () => {
    const list = [meeting(1, 10), meeting(2, 11), meeting(3, 12)]
    const one = buildGroupContext([list[2] as ContextMeeting], none).chars
    const built = buildGroupContext(list, none, Math.floor(one * 1.3))
    expect(built.refs.find((ref) => ref.label === 3)?.level).toBe('full')
    expect(built.refs.find((ref) => ref.label === 1)?.level).not.toBe('full')
  })

  it('as que perderam a Transcrição inteira levam os trechos que casam com a pergunta', () => {
    const list = [meeting(1, 10), meeting(2, 11)]
    const relevance = new Map<string, MeetingRelevance>([
      ['m1', { score: 5, offsets: [20 * 60_000] }],
      ['m2', { score: 1, offsets: [30 * 60_000] }]
    ])
    const one = buildGroupContext([list[0] as ContextMeeting], none).chars
    const built = buildGroupContext(list, relevance, Math.floor(one * 1.5))
    const second = built.refs.find((ref) => ref.label === 2)
    expect(second?.level).toBe('excerpts')
    expect(built.text).toContain('TRECHOS MAIS RELEVANTES')
    expect(built.text).toContain('[30:00] Ana: tema2 fala número 30')
    // vizinhas do trecho
    expect(built.text).toContain('[29:00] Falante 2: tema2 fala número 29')
    expect(built.text).not.toContain('tema2 fala número 5 ')
  })

  it('sem Resumo e sem trecho que case, leva a abertura da Transcrição', () => {
    const list = [meeting(1, 10), meeting(2, 11, { summary: null })]
    const relevance = new Map<string, MeetingRelevance>([['m1', { score: 5, offsets: [] }]])
    const one = buildGroupContext([list[0] as ContextMeeting], none).chars
    const built = buildGroupContext(list, relevance, Math.floor(one * 1.4))
    expect(built.refs.find((ref) => ref.label === 2)?.level).toBe('excerpts')
    expect(built.text).toContain('TRECHOS INICIAIS')
    expect(built.text).toContain('tema2 fala número 0')
  })

  it('orçamento mínimo: só cabeçalho e Resumo, e o texto nunca passa do orçamento folgado', () => {
    const list = Array.from({ length: 5 }, (_, index) => meeting(index + 1, 10 + index))
    const built = buildGroupContext(list, none, 3000)
    expect(built.refs.every((ref) => ref.level === 'summary')).toBe(true)
    expect(built.text).not.toContain('TRANSCRIÇÃO:')
    expect(built.chars).toBeLessThanOrEqual(3000)
  })

  it('orçamento ainda menor que os Resumos: cada Reunião ganha uma fatia', () => {
    const list = Array.from({ length: 4 }, (_, index) => meeting(index + 1, 10 + index))
    const built = buildGroupContext(list, none, 800)
    expect(built.chars).toBeLessThanOrEqual(800)
    for (const label of [1, 2, 3, 4]) expect(built.text).toContain(`R${label} · Reunião ${label}`)
  })

  it('sem Resumo nem trechos possíveis o nível é só o título', () => {
    const lone = meeting(1, 10, {
      summary: null,
      transcript: { ...transcript('x'), utterances: [] }
    })
    expect(buildGroupContext([lone], none).refs[0]?.level).toBe('header')
  })

  it('o orçamento padrão comporta ~7 Reuniões médias de 31 mil caracteres', () => {
    expect(CONTEXT_BUDGET_CHARS).toBe(220_000)
    expect(estimateTokens(CONTEXT_BUDGET_CHARS)).toBeLessThan(70_000)
    expect(estimateTokens(1000)).toBe(295)
  })
})

describe('relevanceQuery', () => {
  it('tira palavras comuns e junta as demais em OU, em prefixo', () => {
    expect(relevanceQuery('O que foi decidido sobre o prazo do contrato?')).toBe(
      '"decidido"* OR "prazo"* OR "contrato"*'
    )
  })

  it('ignora acentos e maiúsculas, mantém números e tira repetidas', () => {
    expect(relevanceQuery('Orçamento ORCAMENTO 2026 de TI')).toBe('"orcamento"* OR "2026"*')
  })

  it('pergunta só com palavras comuns não gera consulta', () => {
    expect(relevanceQuery('O que foi isso?')).toBeNull()
    expect(relevanceQuery('')).toBeNull()
  })

  it('não deixa aspas ou operadores do FTS passarem', () => {
    expect(relevanceQuery('prazo" OR NEAR(x) *')).toBe('"prazo"* OR "near"*')
  })
})
