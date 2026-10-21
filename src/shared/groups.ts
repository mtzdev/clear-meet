import type { Result } from './recording'
import { hasTag, tagKey } from './tags'

/** Pasta (dentro da pasta das Reuniões) e arquivo com a definição dos grupos. */
export const GROUPS_DIR = '.clearmeet'
export const GROUPS_FILE = 'groups.json'
export const GROUPS_SCHEMA_VERSION = 1

export const MAX_GROUP_NAME_LENGTH = 60
export const MAX_GROUP_DESCRIPTION_LENGTH = 200
export const MAX_RULE_TEXT_LENGTH = 80
/** Valor do filtro de grupo da Biblioteca que pede só as Reuniões sem grupo. */
export const UNGROUPED_FILTER = 'none'

/** Identidade do `groupId` lido de um arquivo: texto simples e curto. */
const MAX_GROUP_ID_LENGTH = 100

export const WEEKDAY_SHORT = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'] as const
export const WEEKDAY_LONG = [
  'Domingo',
  'Segunda',
  'Terça',
  'Quarta',
  'Quinta',
  'Sexta',
  'Sábado'
] as const
/** Ordem de exibição: a semana começa na segunda. */
export const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0] as const

/**
 * Regras de um grupo automático; todas as preenchidas precisam bater (E). Horários em minutos
 * desde a meia-noite e datas `AAAA-MM-DD`, ambos no fuso local, como o usuário vê a Reunião.
 */
export interface GroupRules {
  tag: string | null
  nameContains: string | null
  /** Aplicativo ou Fonte gravada (o nome da janela/tela no `meeting.json`). */
  sourceContains: string | null
  /** 0 = domingo ... 6 = sábado; vazio = qualquer dia. */
  weekdays: number[]
  startFromMin: number | null
  startToMin: number | null
  fromDate: string | null
  toDate: string | null
}

export const EMPTY_RULES: GroupRules = {
  tag: null,
  nameContains: null,
  sourceContains: null,
  weekdays: [],
  startFromMin: null,
  startToMin: null,
  fromDate: null,
  toDate: null
}

export interface GroupDef {
  id: string
  name: string
  description: string
  createdAt: string
  /** `null` = grupo manual. */
  rules: GroupRules | null
}

/** Conteúdo de `groups.json`; a ordem da lista é a prioridade das regras. */
export interface GroupsFile {
  groups: GroupDef[]
  /** Sugestões que o usuário dispensou (não voltam). */
  dismissed: string[]
}

export const EMPTY_GROUPS_FILE: GroupsFile = { groups: [], dismissed: [] }

/** O que as regras enxergam de uma Reunião. */
export interface RuleSubject {
  name: string
  tags: readonly string[]
  sourceName: string | null
  /** ISO 8601 (UTC): início da gravação. */
  createdAt: string
}

/** Um grupo para a UI, com os números que o índice calcula. */
export interface GroupInfo extends GroupDef {
  count: number
  totalDurationMs: number
  /** Início da Reunião mais recente do grupo; `null` se está vazio. */
  lastMeetingAt: string | null
}

export interface GroupWithApplied {
  group: GroupInfo
  /** Reuniões sem grupo que entraram no grupo pelas regras. */
  applied: number
}

export type SuggestionBasis = 'name' | 'tag' | 'source' | 'schedule'

export interface GroupSuggestion {
  /** Estável entre execuções: é o que fica guardado ao dispensar. */
  id: string
  basis: SuggestionBasis
  name: string
  /** Reuniões sem grupo que a regra pega hoje. */
  count: number
  rules: GroupRules
}

export interface GroupsOverview {
  /** Falso quando a pasta das Reuniões não deixa ler ou gravar a definição dos grupos. */
  editable: boolean
  message: string | null
  groups: GroupInfo[]
  /** Reuniões prontas sem grupo. */
  ungroupedCount: number
  suggestions: GroupSuggestion[]
}

export interface GroupInput {
  name: string
  description: string
  /** `null` = grupo manual. */
  rules: GroupRules | null
}

// --- Texto -----------------------------------------------------------------------------------

/** Compara texto sem diferenciar maiúsculas, acentos nem espaços repetidos. */
export function textKey(text: string): string {
  return tagKey(text).replace(/\s+/g, ' ').trim()
}

function withoutControlChars(text: string): string {
  return Array.from(text, (char) => {
    const code = char.charCodeAt(0)
    return code < 32 || code === 127 ? ' ' : char
  }).join('')
}

function cleanLine(raw: unknown, max: number): string {
  if (typeof raw !== 'string') return ''
  return withoutControlChars(raw).replace(/\s+/g, ' ').trim().slice(0, max)
}

export type TextCheck = { ok: true; value: string } | { ok: false; message: string }

export function checkGroupName(raw: unknown): TextCheck {
  const name = cleanLine(raw, MAX_GROUP_NAME_LENGTH + 1)
  if (name === '') return { ok: false, message: 'Digite um nome para o grupo.' }
  if (name.length > MAX_GROUP_NAME_LENGTH) {
    return { ok: false, message: `O nome pode ter até ${MAX_GROUP_NAME_LENGTH} caracteres.` }
  }
  return { ok: true, value: name }
}

export function cleanGroupDescription(raw: unknown): string {
  return cleanLine(raw, MAX_GROUP_DESCRIPTION_LENGTH)
}

export function groupNameTaken(
  groups: readonly Pick<GroupDef, 'id' | 'name'>[],
  name: string,
  exceptId: string | null = null
): boolean {
  const key = textKey(name)
  return groups.some((group) => group.id !== exceptId && textKey(group.name) === key)
}

// --- Regras ----------------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function ruleText(raw: unknown): string | null {
  const text = cleanLine(raw, MAX_RULE_TEXT_LENGTH)
  return text === '' ? null : text
}

function minuteOrNull(raw: unknown): number | null {
  return typeof raw === 'number' && Number.isInteger(raw) && raw >= 0 && raw <= 1439 ? raw : null
}

function dateOrNull(raw: unknown): string | null {
  if (typeof raw !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null
  const parsed = new Date(`${raw}T00:00:00Z`)
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== raw ? null : raw
}

export function hasConditions(rules: GroupRules): boolean {
  return (
    rules.tag !== null ||
    rules.nameContains !== null ||
    rules.sourceContains !== null ||
    rules.weekdays.length > 0 ||
    rules.startFromMin !== null ||
    rules.startToMin !== null ||
    rules.fromDate !== null ||
    rules.toDate !== null
  )
}

/**
 * Lê as regras de um arquivo ou de um pedido: descarta o que não é válido. `null` quando não
 * sobra nenhuma condição (o grupo vira manual).
 */
export function parseRules(raw: unknown): GroupRules | null {
  if (!isRecord(raw)) return null
  const tag = typeof raw['tag'] === 'string' ? ruleText(raw['tag']) : null
  const weekdays = Array.isArray(raw['weekdays'])
    ? [
        ...new Set(
          raw['weekdays'].filter(
            (day): day is number =>
              Number.isInteger(day) && (day as number) >= 0 && (day as number) <= 6
          )
        )
      ].sort((a, b) => a - b)
    : []
  const rules: GroupRules = {
    tag,
    nameContains: ruleText(raw['nameContains']),
    sourceContains: ruleText(raw['sourceContains']),
    weekdays,
    startFromMin: minuteOrNull(raw['startFromMin']),
    startToMin: minuteOrNull(raw['startToMin']),
    fromDate: dateOrNull(raw['fromDate']),
    toDate: dateOrNull(raw['toDate'])
  }
  return hasConditions(rules) ? rules : null
}

/** Mensagem do problema nas regras (horário ou período invertidos), ou `null`. */
export function rulesProblem(rules: GroupRules): string | null {
  if (
    rules.startFromMin !== null &&
    rules.startToMin !== null &&
    rules.startFromMin > rules.startToMin
  ) {
    return 'O horário inicial precisa ser antes do final.'
  }
  if (rules.fromDate !== null && rules.toDate !== null && rules.fromDate > rules.toDate) {
    return 'A data inicial precisa ser antes da final.'
  }
  return null
}

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

interface LocalParts {
  weekday: number
  minutes: number
  date: string
}

function localParts(iso: string): LocalParts | null {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return null
  return {
    weekday: date.getDay(),
    minutes: date.getHours() * 60 + date.getMinutes(),
    date: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
  }
}

/** A Reunião satisfaz todas as condições preenchidas? Regras vazias não pegam nada. */
export function matchesRules(rules: GroupRules, subject: RuleSubject): boolean {
  if (!hasConditions(rules)) return false
  if (rules.tag !== null && !hasTag(subject.tags, rules.tag)) return false
  if (rules.nameContains !== null && !textKey(subject.name).includes(textKey(rules.nameContains))) {
    return false
  }
  if (rules.sourceContains !== null) {
    if (subject.sourceName === null) return false
    if (!textKey(subject.sourceName).includes(textKey(rules.sourceContains))) return false
  }
  const needsTime =
    rules.weekdays.length > 0 ||
    rules.startFromMin !== null ||
    rules.startToMin !== null ||
    rules.fromDate !== null ||
    rules.toDate !== null
  if (!needsTime) return true
  const parts = localParts(subject.createdAt)
  if (!parts) return false
  if (rules.weekdays.length > 0 && !rules.weekdays.includes(parts.weekday)) return false
  if (rules.startFromMin !== null && parts.minutes < rules.startFromMin) return false
  if (rules.startToMin !== null && parts.minutes > rules.startToMin) return false
  if (rules.fromDate !== null && parts.date < rules.fromDate) return false
  if (rules.toDate !== null && parts.date > rules.toDate) return false
  return true
}

/** Primeiro grupo automático (na ordem de prioridade) cujas regras pegam a Reunião. */
export function firstMatchingGroup(
  groups: readonly GroupDef[],
  subject: RuleSubject
): GroupDef | null {
  return groups.find((group) => group.rules !== null && matchesRules(group.rules, subject)) ?? null
}

export function formatMinutes(minutes: number): string {
  return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`
}

function formatDate(date: string): string {
  const [year, month, day] = date.split('-')
  return `${day}/${month}/${year}`
}

/** As condições em frases curtas, para o cartão do grupo e a sugestão. */
export function describeRules(rules: GroupRules): string[] {
  const lines: string[] = []
  if (rules.tag !== null) lines.push(`Tag [${rules.tag}]`)
  if (rules.nameContains !== null) lines.push(`Nome contém “${rules.nameContains}”`)
  if (rules.sourceContains !== null) lines.push(`Fonte contém “${rules.sourceContains}”`)
  if (rules.weekdays.length > 0) {
    const days = WEEKDAY_ORDER.filter((day) => rules.weekdays.includes(day)).map(
      (day) => WEEKDAY_SHORT[day]
    )
    lines.push(days.join(', '))
  }
  if (rules.startFromMin !== null && rules.startToMin !== null) {
    lines.push(
      `Início entre ${formatMinutes(rules.startFromMin)} e ${formatMinutes(rules.startToMin)}`
    )
  } else if (rules.startFromMin !== null) {
    lines.push(`Início a partir de ${formatMinutes(rules.startFromMin)}`)
  } else if (rules.startToMin !== null) {
    lines.push(`Início até ${formatMinutes(rules.startToMin)}`)
  }
  if (rules.fromDate !== null && rules.toDate !== null) {
    lines.push(`De ${formatDate(rules.fromDate)} a ${formatDate(rules.toDate)}`)
  } else if (rules.fromDate !== null) {
    lines.push(`A partir de ${formatDate(rules.fromDate)}`)
  } else if (rules.toDate !== null) {
    lines.push(`Até ${formatDate(rules.toDate)}`)
  }
  return lines
}

// --- Pedido da UI ----------------------------------------------------------------------------

/** Confere nome, descrição e regras de um pedido de criar/editar grupo. */
export function cleanGroupInput(raw: unknown): Result<GroupInput> {
  if (!isRecord(raw)) {
    return { ok: false, error: { code: 'invalid-request', message: 'Pedido inválido.' } }
  }
  const name = checkGroupName(raw['name'])
  if (!name.ok) return { ok: false, error: { code: 'invalid-request', message: name.message } }
  let rules: GroupRules | null = null
  if (raw['rules'] !== null && raw['rules'] !== undefined) {
    rules = parseRules(raw['rules'])
    if (rules === null) {
      return {
        ok: false,
        error: {
          code: 'invalid-request',
          message: 'Defina ao menos uma regra para o grupo automático.'
        }
      }
    }
    const problem = rulesProblem(rules)
    if (problem) return { ok: false, error: { code: 'invalid-request', message: problem } }
  }
  return {
    ok: true,
    value: { name: name.value, description: cleanGroupDescription(raw['description']), rules }
  }
}

// --- Arquivo ---------------------------------------------------------------------------------

/** `groupId` lido do `meeting.json`: texto não vazio ou nada. */
export function parseGroupId(raw: unknown): string | null {
  return typeof raw === 'string' && raw !== '' && raw.length <= MAX_GROUP_ID_LENGTH ? raw : null
}

/**
 * Lê `groups.json` de forma tolerante: grupos inválidos, sem id ou repetidos são ignorados;
 * um nome repetido continua valendo (o arquivo pode ter vindo de outro PC).
 */
export function parseGroupsFile(raw: unknown): GroupsFile {
  if (!isRecord(raw)) return { groups: [], dismissed: [] }
  const groups: GroupDef[] = []
  const seen = new Set<string>()
  if (Array.isArray(raw['groups'])) {
    for (const item of raw['groups']) {
      if (!isRecord(item)) continue
      const id = parseGroupId(item['id'])
      const name = cleanLine(item['name'], MAX_GROUP_NAME_LENGTH)
      if (id === null || name === '' || seen.has(id)) continue
      seen.add(id)
      const createdAt =
        typeof item['createdAt'] === 'string' && !Number.isNaN(Date.parse(item['createdAt']))
          ? item['createdAt']
          : new Date(0).toISOString()
      groups.push({
        id,
        name,
        description: cleanGroupDescription(item['description']),
        createdAt,
        rules: parseRules(item['rules'])
      })
    }
  }
  const dismissed = Array.isArray(raw['dismissed'])
    ? [
        ...new Set(
          raw['dismissed'].filter(
            (id): id is string => typeof id === 'string' && id !== '' && id.length <= 200
          )
        )
      ]
    : []
  return { groups, dismissed }
}

export function serializeGroupsFile(file: GroupsFile): string {
  return `${JSON.stringify({ schemaVersion: GROUPS_SCHEMA_VERSION, ...file }, null, 2)}\n`
}

/** Troca a posição dos grupos conforme `ids`; grupos fora da lista ficam no fim, na ordem atual. */
export function reorderGroups(groups: readonly GroupDef[], ids: readonly string[]): GroupDef[] {
  const byId = new Map(groups.map((group) => [group.id, group]))
  const ordered: GroupDef[] = []
  for (const id of ids) {
    const group = byId.get(id)
    if (group) {
      ordered.push(group)
      byId.delete(id)
    }
  }
  return [...ordered, ...byId.values()]
}
