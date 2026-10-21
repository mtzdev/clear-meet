import { describe, expect, it } from 'vitest'
import { EMPTY_RULES } from '@shared/groups'
import { draftToRules, EMPTY_DRAFT, rulesToDraft } from './group-rules-draft'

describe('rascunho das regras', () => {
  it('formulário vazio não vira regra', () => {
    expect(draftToRules(EMPTY_DRAFT)).toBeNull()
    expect(draftToRules({ ...EMPTY_DRAFT, nameContains: '   ' })).toBeNull()
  })

  it('converte horários e datas e ignora campos inválidos', () => {
    const rules = draftToRules({
      ...EMPTY_DRAFT,
      nameContains: ' Daily ',
      weekdays: [3, 1, 1],
      startFrom: '09:30',
      startTo: '25:00',
      fromDate: '2026-10-01',
      toDate: '31/10/2026'
    })
    expect(rules).toEqual({
      ...EMPTY_RULES,
      nameContains: 'Daily',
      weekdays: [1, 3],
      startFromMin: 570,
      fromDate: '2026-10-01'
    })
  })

  it('vai e volta sem perder nada', () => {
    const rules = {
      ...EMPTY_RULES,
      tag: 'Daily',
      sourceContains: 'Meet',
      weekdays: [2],
      startFromMin: 60,
      startToMin: 130,
      toDate: '2026-12-31'
    }
    expect(draftToRules(rulesToDraft(rules))).toEqual(rules)
    expect(rulesToDraft(null)).toEqual(EMPTY_DRAFT)
  })
})
