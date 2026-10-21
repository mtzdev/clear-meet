import {
  EMPTY_RULES,
  formatMinutes,
  matchesRules,
  MAX_GROUP_NAME_LENGTH,
  textKey,
  WEEKDAY_LONG,
  type GroupRules,
  type GroupSuggestion,
  type RuleSubject
} from './groups'
import { tagKey } from './tags'

export const MIN_SUGGESTION_MEETINGS = 3
const MAX_SUGGESTIONS = 5
const MAX_PREFIX_WORDS = 5
const MIN_PREFIX_LENGTH = 3
/** Duas sugestões que dividem mais que isso das Reuniões são a mesma ideia: vale a mais forte. */
const OVERLAP_LIMIT = 0.7
/** Reuniões do mesmo dia da semana a até este tempo uma da outra contam como o mesmo horário. */
const SCHEDULE_SPAN_MIN = 30
const SCHEDULE_PADDING_MIN = 15

export interface SuggestionSubject extends RuleSubject {
  id: string
  sourceKind: string
}

export interface SuggestionOptions {
  /** Ids das sugestões já dispensadas. */
  dismissed: readonly string[]
  /** Nomes dos grupos que existem (uma sugestão não repete o nome de um grupo). */
  groupNames: readonly string[]
  min?: number
}

/** Palavras que sozinhas não dizem nada sobre a Reunião (o nome padrão é "Reunião de 10/10 14:30"). */
const GENERIC_PREFIXES = new Set([
  'reuniao',
  'reunioes',
  'reuniao de',
  'gravacao',
  'meeting',
  'call',
  'sem titulo',
  'nova reuniao',
  'teste'
])
const CONNECTORS = new Set(['de', 'do', 'da', 'em', 'as', 'a', 'o', 'no', 'na', 'para', 'com'])
const TRAILING_PUNCTUATION = /[\s:;,.\-–—|/·_()[\]]+$/
const SEPARATOR_ONLY = /^[\s:;,.\-–—|/·_()[\]]*$/

/**
 * Parte do nome que se repete entre as Reuniões de uma série: as palavras antes da primeira
 * data, hora ou número ("Daily 14 10 10 00" -> "Daily"). `null` se não sobra nada útil.
 */
export function namePrefix(name: string): string | null {
  const kept: string[] = []
  for (const token of name.trim().split(/\s+/)) {
    const digit = token.search(/\d/)
    if (digit === -1) {
      kept.push(token)
      continue
    }
    const lead = token.slice(0, digit).replace(TRAILING_PUNCTUATION, '')
    if (lead !== '') kept.push(lead)
    break
  }
  while (kept.length > 0) {
    const last = kept[kept.length - 1] ?? ''
    if (SEPARATOR_ONLY.test(last) || CONNECTORS.has(textKey(last))) kept.pop()
    else break
  }
  if (kept.length === 0 || kept.length > MAX_PREFIX_WORDS) return null
  const prefix = kept.join(' ').replace(TRAILING_PUNCTUATION, '')
  if (prefix.length < MIN_PREFIX_LENGTH || prefix.length > MAX_GROUP_NAME_LENGTH) return null
  return GENERIC_PREFIXES.has(textKey(prefix)) ? null : prefix
}

interface Candidate {
  id: string
  basis: GroupSuggestion['basis']
  name: string
  rules: GroupRules
  members: Set<string>
}

function mostCommon(values: string[]): string {
  const counts = new Map<string, number>()
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1)
  let best = values[0] ?? ''
  let bestCount = 0
  for (const [value, count] of counts) {
    if (count > bestCount) {
      best = value
      bestCount = count
    }
  }
  return best
}

function byName(subjects: readonly SuggestionSubject[], min: number): Candidate[] {
  const buckets = new Map<string, { prefixes: string[]; ids: Set<string> }>()
  for (const subject of subjects) {
    const prefix = namePrefix(subject.name)
    if (prefix === null) continue
    const key = textKey(prefix)
    const bucket = buckets.get(key) ?? { prefixes: [], ids: new Set<string>() }
    bucket.prefixes.push(prefix)
    bucket.ids.add(subject.id)
    buckets.set(key, bucket)
  }
  const found: Candidate[] = []
  for (const [key, bucket] of buckets) {
    if (bucket.ids.size < min) continue
    const name = mostCommon(bucket.prefixes)
    found.push({
      id: `name:${key}`,
      basis: 'name',
      name,
      rules: { ...EMPTY_RULES, nameContains: name },
      members: bucket.ids
    })
  }
  return found
}

function byTag(subjects: readonly SuggestionSubject[], min: number): Candidate[] {
  const buckets = new Map<string, { names: string[]; ids: Set<string> }>()
  for (const subject of subjects) {
    for (const tag of subject.tags) {
      const key = tagKey(tag)
      const bucket = buckets.get(key) ?? { names: [], ids: new Set<string>() }
      bucket.names.push(tag)
      bucket.ids.add(subject.id)
      buckets.set(key, bucket)
    }
  }
  const found: Candidate[] = []
  for (const [key, bucket] of buckets) {
    if (bucket.ids.size < min) continue
    const name = mostCommon(bucket.names)
    found.push({
      id: `tag:${key}`,
      basis: 'tag',
      name,
      rules: { ...EMPTY_RULES, tag: name },
      members: bucket.ids
    })
  }
  return found
}

function bySource(subjects: readonly SuggestionSubject[], min: number): Candidate[] {
  const buckets = new Map<string, { names: string[]; ids: Set<string> }>()
  for (const subject of subjects) {
    if (subject.sourceKind !== 'window' || subject.sourceName === null) continue
    const name = subject.sourceName.replace(/\s+/g, ' ').trim()
    if (name === '' || name.length > MAX_GROUP_NAME_LENGTH) continue
    const key = textKey(name)
    const bucket = buckets.get(key) ?? { names: [], ids: new Set<string>() }
    bucket.names.push(name)
    bucket.ids.add(subject.id)
    buckets.set(key, bucket)
  }
  const found: Candidate[] = []
  for (const [key, bucket] of buckets) {
    if (bucket.ids.size < min) continue
    const name = mostCommon(bucket.names)
    found.push({
      id: `source:${key}`,
      basis: 'source',
      name,
      rules: { ...EMPTY_RULES, sourceContains: name },
      members: bucket.ids
    })
  }
  return found
}

function bySchedule(subjects: readonly SuggestionSubject[], min: number): Candidate[] {
  const perDay = new Map<number, { id: string; minutes: number; date: string }[]>()
  for (const subject of subjects) {
    const date = new Date(subject.createdAt)
    if (Number.isNaN(date.getTime())) continue
    const list = perDay.get(date.getDay()) ?? []
    list.push({
      id: subject.id,
      minutes: date.getHours() * 60 + date.getMinutes(),
      date: `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`
    })
    perDay.set(date.getDay(), list)
  }
  const found: Candidate[] = []
  for (const [weekday, list] of perDay) {
    list.sort((a, b) => a.minutes - b.minutes)
    let start = 0
    while (start < list.length) {
      let end = start
      while (
        end + 1 < list.length &&
        (list[end + 1]?.minutes ?? 0) - (list[start]?.minutes ?? 0) <= SCHEDULE_SPAN_MIN
      ) {
        end += 1
      }
      const cluster = list.slice(start, end + 1)
      start = end + 1
      if (new Set(cluster.map((item) => item.date)).size < min) continue
      const first = cluster[0]?.minutes ?? 0
      const last = cluster[cluster.length - 1]?.minutes ?? 0
      const from = Math.max(0, first - SCHEDULE_PADDING_MIN)
      const to = Math.min(1439, last + SCHEDULE_PADDING_MIN)
      const center = Math.round((first + last) / 2 / 15) * 15
      found.push({
        id: `schedule:${weekday}:${center}`,
        basis: 'schedule',
        name: `${WEEKDAY_LONG[weekday]} às ${formatMinutes(Math.min(center, 1439))}`,
        rules: { ...EMPTY_RULES, weekdays: [weekday], startFromMin: from, startToMin: to },
        members: new Set(cluster.map((item) => item.id))
      })
    }
  }
  return found
}

function overlapsTooMuch(candidate: Candidate, covered: ReadonlySet<string>): boolean {
  let shared = 0
  for (const id of candidate.members) if (covered.has(id)) shared += 1
  return shared / candidate.members.size >= OVERLAP_LIMIT
}

/**
 * Séries de Reuniões que ainda não têm grupo: o mesmo começo de nome, a mesma Tag, o mesmo
 * aplicativo ou o mesmo dia e horário, com pelo menos `min` Reuniões. Recebe só Reuniões sem
 * grupo (e que nenhuma regra existente pega). A contagem de cada sugestão vem da própria regra,
 * então é o que "aceitar" vai mesmo pegar.
 */
export function suggestGroups(
  subjects: readonly SuggestionSubject[],
  options: SuggestionOptions
): GroupSuggestion[] {
  const min = options.min ?? MIN_SUGGESTION_MEETINGS
  const dismissed = new Set(options.dismissed)
  const takenNames = new Set(options.groupNames.map(textKey))
  const candidates = [
    ...byName(subjects, min),
    ...byTag(subjects, min),
    ...bySource(subjects, min),
    ...bySchedule(subjects, min)
  ]

  const chosen: GroupSuggestion[] = []
  const covered = new Set<string>()
  for (const candidate of candidates) {
    if (dismissed.has(candidate.id) || takenNames.has(textKey(candidate.name))) continue
    if (overlapsTooMuch(candidate, covered)) continue
    const matching = subjects.filter((subject) => matchesRules(candidate.rules, subject))
    if (matching.length < min) continue
    chosen.push({
      id: candidate.id,
      basis: candidate.basis,
      name: candidate.name,
      count: matching.length,
      rules: candidate.rules
    })
    for (const id of candidate.members) covered.add(id)
  }
  return chosen
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, MAX_SUGGESTIONS)
}
