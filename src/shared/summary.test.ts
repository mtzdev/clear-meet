import { describe, expect, it } from 'vitest'
import {
  makeSummaryView,
  NO_SUMMARY,
  parseSummary,
  parseSummaryMeta,
  parseSummaryText,
  serializeSummary,
  summaryToText,
  SUMMARY_SCHEMA_VERSION,
  type SummaryFile
} from './summary'

const summary: SummaryFile = {
  schemaVersion: SUMMARY_SCHEMA_VERSION,
  provider: 'groq',
  model: 'openai/gpt-oss-120b',
  createdAt: '2026-10-13T13:00:00.000Z',
  overview: 'A equipe adiou o lançamento.',
  keyPoints: [{ text: 'Lançamento adiado', at: [5000, 3_723_000] }],
  decisions: [],
  actions: [
    { owner: 'Ana', task: 'Avisar o cliente', due: 'amanhã', at: [65_000] },
    { owner: null, task: 'Revisar o texto', due: null, at: [] }
  ]
}

describe('summary.json', () => {
  it('ida e volta', () => {
    expect(parseSummaryText(serializeSummary(summary))).toEqual({ ok: true, value: summary })
  })

  it('recusa versão, provedor, listas e Instantes inválidos', () => {
    const base = JSON.parse(serializeSummary(summary)) as Record<string, unknown>
    for (const patch of [
      { schemaVersion: 7 },
      { provider: 'openai' },
      { model: 3 },
      { createdAt: 'ontem' },
      { overview: null },
      { keyPoints: 'x' },
      { keyPoints: [{ text: 'a', at: [-1] }] },
      { decisions: [{ text: 1, at: [] }] },
      { actions: [{ owner: 3, task: 'a', due: null, at: [] }] }
    ]) {
      expect(parseSummary({ ...base, ...patch })).toMatchObject({ ok: false })
    }
    expect(parseSummaryText('{ quebrado')).toMatchObject({ ok: false })
    expect(parseSummary([])).toMatchObject({ ok: false })
  })
})

describe('estado do Resumo no meeting.json', () => {
  it('lê o bloco e o transforma na visão da UI', () => {
    const meta = parseSummaryMeta({
      status: 'ready',
      provider: 'gemini',
      model: 'gemini-3.5-flash-lite',
      updatedAt: '2026-10-13T13:00:00.000Z'
    })
    expect(makeSummaryView(meta)).toEqual({
      status: 'ready',
      error: null,
      provider: 'gemini',
      model: 'gemini-3.5-flash-lite',
      updatedAt: '2026-10-13T13:00:00.000Z'
    })
    expect(makeSummaryView(undefined)).toEqual(NO_SUMMARY)
  })

  it('bloco inválido é como se não existisse', () => {
    expect(parseSummaryMeta('x')).toBeUndefined()
    expect(
      parseSummaryMeta({ status: 'quase', updatedAt: '2026-10-13T13:00:00.000Z' })
    ).toBeUndefined()
    expect(parseSummaryMeta({ status: 'ready', updatedAt: 'ontem' })).toBeUndefined()
    expect(
      parseSummaryMeta({ status: 'error', updatedAt: '2026-10-13T13:00:00.000Z', provider: 'x' })
    ).toEqual({ status: 'error', updatedAt: '2026-10-13T13:00:00.000Z' })
  })
})

describe('summaryToText', () => {
  it('Markdown: títulos, negrito no responsável e Instantes entre colchetes', () => {
    expect(summaryToText(summary, 'Planejamento', { markdown: true })).toBe(
      [
        '# Resumo: Planejamento',
        '',
        '## Visão geral',
        'A equipe adiou o lançamento.',
        '',
        '## Pontos principais',
        '- Lançamento adiado [00:05] [1:02:03]',
        '',
        '## Decisões',
        'Nenhuma decisão registrada.',
        '',
        '## Quem faz o quê',
        '- **Ana**: Avisar o cliente (prazo: amanhã) [01:05]',
        '- **Sem responsável definido**: Revisar o texto',
        ''
      ].join('\n')
    )
  })

  it('texto simples: sem marcação', () => {
    const text = summaryToText(summary, 'Planejamento', { markdown: false })
    expect(text).toContain('VISÃO GERAL')
    expect(text).toContain('- Ana: Avisar o cliente (prazo: amanhã) [01:05]')
    expect(text).not.toContain('**')
    expect(text).not.toContain('##')
  })
})
