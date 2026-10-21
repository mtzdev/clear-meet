import { EMPTY_RULES, formatMinutes, parseRules, type GroupRules } from '@shared/groups'

/** Regras como os campos do formulário as guardam (texto), para digitar sem validar a cada tecla. */
export interface RulesDraft {
  tag: string
  nameContains: string
  sourceContains: string
  weekdays: number[]
  startFrom: string
  startTo: string
  fromDate: string
  toDate: string
}

export const EMPTY_DRAFT: RulesDraft = {
  tag: '',
  nameContains: '',
  sourceContains: '',
  weekdays: [],
  startFrom: '',
  startTo: '',
  fromDate: '',
  toDate: ''
}

export function rulesToDraft(rules: GroupRules | null): RulesDraft {
  const source = rules ?? EMPTY_RULES
  return {
    tag: source.tag ?? '',
    nameContains: source.nameContains ?? '',
    sourceContains: source.sourceContains ?? '',
    weekdays: [...source.weekdays],
    startFrom: source.startFromMin === null ? '' : formatMinutes(source.startFromMin),
    startTo: source.startToMin === null ? '' : formatMinutes(source.startToMin),
    fromDate: source.fromDate ?? '',
    toDate: source.toDate ?? ''
  }
}

function minutesOf(time: string): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(time)
  if (!match) return null
  const hours = Number(match[1])
  const minutes = Number(match[2])
  return hours < 24 && minutes < 60 ? hours * 60 + minutes : null
}

/** As regras do formulário; `null` quando nenhum campo está preenchido. */
export function draftToRules(draft: RulesDraft): GroupRules | null {
  return parseRules({
    tag: draft.tag,
    nameContains: draft.nameContains,
    sourceContains: draft.sourceContains,
    weekdays: draft.weekdays,
    startFromMin: minutesOf(draft.startFrom),
    startToMin: minutesOf(draft.startTo),
    fromDate: draft.fromDate === '' ? null : draft.fromDate,
    toDate: draft.toDate === '' ? null : draft.toDate
  })
}
