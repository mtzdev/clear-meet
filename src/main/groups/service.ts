import { suggestGroups } from '@shared/group-suggestions'
import {
  cleanGroupInput,
  firstMatchingGroup,
  groupNameTaken,
  parseRules,
  reorderGroups,
  type GroupDef,
  type GroupInfo,
  type GroupInput,
  type GroupsOverview,
  type GroupWithApplied,
  type GroupSuggestion,
  type RuleSubject
} from '@shared/groups'
import type { MeetingFile } from '@shared/meeting'
import type { RecordingError, RecordingState, Result } from '@shared/recording'
import type { GroupStatsRow } from '../library/db'
import type { IndexedMeeting } from '../library/service'
import { editMeetingGroup } from '../meetings/group-store'
import { isDirectChild, listMeetingFolders, readMeeting } from '../meetings/repository'
import type { GroupStore } from './store'

export interface GroupServiceDeps {
  store: GroupStore
  meetingsDir(): string
  /** Reuniões do índice, para sugestões, prévias e para achar quem aplicar as regras. */
  meetings(): Promise<IndexedMeeting[]>
  stats(): Promise<Map<string, GroupStatsRow>>
  /** Reindexa a pasta depois de alterada. */
  refresh(folder: string): Promise<void>
  /** A definição ou a participação mudou: as telas consultam de novo. */
  emitChanged(): void
  newId(): string
  now(): number
  log?(message: string): void
}

function fail(code: RecordingError['code'], message: string): { ok: false; error: RecordingError } {
  return { ok: false, error: { code, message } }
}

const BUSY_BATCH = 'Há Reuniões sendo gravadas ou processadas. Tente de novo quando terminarem.'
const NAME_TAKEN = 'Já existe um grupo com esse nome.'
const GROUP_MISSING = 'O grupo não existe mais.'

function failedText(count: number): string {
  return count === 1
    ? 'Uma Reunião não pôde ser atualizada. Tente de novo.'
    : `${count} Reuniões não puderam ser atualizadas. Tente de novo.`
}

function subjectOf(meeting: MeetingFile): RuleSubject {
  return {
    name: meeting.name,
    tags: meeting.tags ?? [],
    sourceName: meeting.source.name,
    createdAt: meeting.createdAt
  }
}

/**
 * Grupos: a definição fica em `groups.json` (`GroupStore`) e a participação de cada Reunião no
 * `meeting.json` (`groupId`), editada pela fila da pasta. Uma Reunião tem no máximo um grupo. As
 * regras só agem em Reunião sem grupo e nunca tiram uma Reunião de um grupo escolhido à mão; a
 * ordem dos grupos é a prioridade. As alterações em lote recusam Reuniões ainda gravando ou
 * processando e leem os arquivos, não o índice.
 */
export class GroupService {
  private lastPhase: RecordingState['phase'] | null = null

  constructor(private readonly deps: GroupServiceDeps) {}

  // --- Leitura --------------------------------------------------------------------------------

  async overview(recheck = false): Promise<GroupsOverview> {
    const status = await this.deps.store.status(recheck)
    const read = await this.deps.store.read()
    if (!read.ok) {
      return {
        editable: false,
        message: read.message,
        groups: [],
        ungroupedCount: 0,
        suggestions: []
      }
    }
    const { groups, dismissed } = read.file
    const [meetings, stats] = await Promise.all([this.deps.meetings(), this.deps.stats()])
    const ungrouped = meetings.filter((meeting) => meeting.status === 'ready' && !meeting.groupId)
    return {
      editable: status.editable,
      message: status.message,
      groups: groups.map((group) => this.info(group, stats)),
      ungroupedCount: ungrouped.length,
      suggestions: status.editable ? this.suggestions(groups, dismissed, ungrouped) : []
    }
  }

  private info(group: GroupDef, stats: Map<string, GroupStatsRow>): GroupInfo {
    const row = stats.get(group.id)
    return {
      ...group,
      count: row?.count ?? 0,
      totalDurationMs: row?.totalDurationMs ?? 0,
      lastMeetingAt: row ? new Date(row.lastMs).toISOString() : null
    }
  }

  private suggestions(
    groups: readonly GroupDef[],
    dismissed: readonly string[],
    ungrouped: readonly IndexedMeeting[]
  ): GroupSuggestion[] {
    // Quem já cai nas regras de um grupo existente não vira sugestão de outro.
    const free = ungrouped.filter((meeting) => firstMatchingGroup(groups, meeting) === null)
    return suggestGroups(free, { dismissed, groupNames: groups.map((group) => group.name) })
  }

  /**
   * Quantas Reuniões sem grupo entrariam num grupo com estas regras, respeitando a prioridade
   * (`groupId` = grupo que está sendo editado; `null` = grupo novo, no fim da lista).
   */
  async preview(rawRules: unknown, groupId: string | null): Promise<{ matching: number }> {
    const rules = parseRules(rawRules)
    if (rules === null) return { matching: 0 }
    const read = await this.deps.store.read()
    if (!read.ok) return { matching: 0 }
    const candidate: GroupDef = {
      id: groupId ?? '\u0000novo',
      name: '',
      description: '',
      createdAt: '',
      rules
    }
    const list = read.file.groups.some((group) => group.id === groupId)
      ? read.file.groups.map((group) => (group.id === groupId ? candidate : group))
      : [...read.file.groups, candidate]
    const meetings = await this.deps.meetings()
    const matching = meetings.filter(
      (meeting) =>
        meeting.status === 'ready' &&
        !meeting.groupId &&
        firstMatchingGroup(list, meeting)?.id === candidate.id
    ).length
    return { matching }
  }

  // --- Criar, editar, apagar -------------------------------------------------------------------

  async create(rawInput: unknown, applyNow: boolean): Promise<Result<GroupWithApplied>> {
    const input = cleanGroupInput(rawInput)
    if (!input.ok) return input
    return this.add(input.value, applyNow)
  }

  private async add(input: GroupInput, applyNow: boolean): Promise<Result<GroupWithApplied>> {
    const id = this.deps.newId()
    const saved = await this.deps.store.update((file) => {
      if (groupNameTaken(file.groups, input.name)) return NAME_TAKEN
      const group: GroupDef = {
        id,
        name: input.name,
        description: input.description,
        createdAt: new Date(this.deps.now()).toISOString(),
        rules: input.rules
      }
      return { ...file, groups: [...file.groups, group] }
    })
    if (!saved.ok) return saved
    return this.finish(id, applyNow && input.rules !== null)
  }

  async update(
    id: string,
    rawInput: unknown,
    applyNow: boolean
  ): Promise<Result<GroupWithApplied>> {
    const input = cleanGroupInput(rawInput)
    if (!input.ok) return input
    const saved = await this.deps.store.update((file) => {
      const current = file.groups.find((group) => group.id === id)
      if (!current) return GROUP_MISSING
      if (groupNameTaken(file.groups, input.value.name, id)) return NAME_TAKEN
      return {
        ...file,
        groups: file.groups.map((group) => (group.id === id ? { ...group, ...input.value } : group))
      }
    })
    if (!saved.ok) {
      return saved.error.message === GROUP_MISSING ? fail('not-found', GROUP_MISSING) : saved
    }
    return this.finish(id, applyNow && input.value.rules !== null)
  }

  private async finish(id: string, apply: boolean): Promise<Result<GroupWithApplied>> {
    const applied = apply ? await this.applyRules(id) : 0
    this.deps.emitChanged()
    const overview = await this.overview()
    const group = overview.groups.find((item) => item.id === id)
    if (!group) return fail('not-found', GROUP_MISSING)
    return { ok: true, value: { group, applied } }
  }

  /** Apaga o grupo; as Reuniões continuam, sem grupo. */
  async delete(id: string): Promise<Result<{ updated: number }>> {
    const read = await this.deps.store.read()
    if (!read.ok) return fail('unknown', read.message)
    if (!read.file.groups.some((group) => group.id === id)) return fail('not-found', GROUP_MISSING)

    const holders = await this.holders(id)
    if (holders.some((holder) => !holder.ready)) return fail('busy', BUSY_BATCH)
    const saved = await this.deps.store.update((file) =>
      file.groups.some((group) => group.id === id)
        ? { ...file, groups: file.groups.filter((group) => group.id !== id) }
        : null
    )
    if (!saved.ok) return saved
    // Sem o grupo na definição, quem ainda aponta para ele já conta como sem grupo.
    let updated = 0
    let failed = 0
    for (const holder of holders) {
      const result = await editMeetingGroup(this.deps.meetingsDir(), holder.folder, (meeting) =>
        meeting.groupId === id ? null : undefined
      )
      if (result.ok) updated += 1
      else failed += 1
      await this.deps.refresh(holder.folder)
    }
    this.deps.emitChanged()
    return failed > 0 ? fail('unknown', failedText(failed)) : { ok: true, value: { updated } }
  }

  async reorder(ids: readonly string[]): Promise<Result<null>> {
    if (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string')) {
      return fail('invalid-request', 'Pedido inválido.')
    }
    const saved = await this.deps.store.update((file) => {
      const next = reorderGroups(file.groups, ids)
      return next.every((group, index) => group.id === file.groups[index]?.id)
        ? null
        : { ...file, groups: next }
    })
    if (!saved.ok) return saved
    this.deps.emitChanged()
    return { ok: true, value: null }
  }

  /** Pastas cujo `meeting.json` aponta para o grupo (lido do disco, que é a verdade). */
  private async holders(id: string): Promise<{ folder: string; ready: boolean }[]> {
    const found: { folder: string; ready: boolean }[] = []
    for (const folder of await listMeetingFolders(this.deps.meetingsDir())) {
      const read = await readMeeting(folder)
      if (read.ok && read.value.groupId === id) {
        found.push({ folder, ready: read.value.status === 'ready' })
      }
    }
    return found
  }

  // --- Mover Reuniões --------------------------------------------------------------------------

  /** Põe as Reuniões no grupo (substituindo o que tinham) ou, com `null`, tira do grupo. */
  async setGroup(
    rawFolders: unknown,
    groupId: string | null
  ): Promise<Result<{ updated: number }>> {
    const folders = Array.isArray(rawFolders)
      ? rawFolders.filter((folder): folder is string => typeof folder === 'string')
      : []
    if (folders.length === 0 || folders.length !== (rawFolders as unknown[]).length) {
      return fail('invalid-request', 'Escolha ao menos uma Reunião.')
    }
    const root = this.deps.meetingsDir()
    if (folders.some((folder) => !isDirectChild(root, folder))) {
      return fail('invalid-request', 'A pasta não está dentro da pasta das Reuniões.')
    }
    if (groupId !== null) {
      const read = await this.deps.store.read()
      if (!read.ok) return fail('unknown', read.message)
      if (!read.file.groups.some((group) => group.id === groupId)) {
        return fail('not-found', GROUP_MISSING)
      }
    }
    for (const folder of folders) {
      const read = await readMeeting(folder)
      if (read.ok && read.value.status !== 'ready') return fail('busy', BUSY_BATCH)
    }
    let updated = 0
    let failed = 0
    for (const folder of folders) {
      const result = await editMeetingGroup(root, folder, () => groupId)
      if (result.ok) updated += 1
      else failed += 1
      await this.deps.refresh(folder)
    }
    this.deps.emitChanged()
    return failed > 0 ? fail('unknown', failedText(failed)) : { ok: true, value: { updated } }
  }

  // --- Regras ----------------------------------------------------------------------------------

  /**
   * Põe no grupo as Reuniões prontas e sem grupo em que ele é o primeiro a combinar. Cada
   * Reunião é conferida de novo no `meeting.json` dentro da fila da pasta.
   */
  private async applyRules(id: string): Promise<number> {
    const read = await this.deps.store.read()
    if (!read.ok) return 0
    const { groups } = read.file
    const known = new Set(groups.map((group) => group.id))
    const candidates = (await this.deps.meetings()).filter(
      (meeting) =>
        meeting.status === 'ready' &&
        !meeting.groupId &&
        firstMatchingGroup(groups, meeting)?.id === id
    )
    let applied = 0
    for (const candidate of candidates) {
      const result = await editMeetingGroup(
        this.deps.meetingsDir(),
        candidate.folder,
        (meeting) => {
          if (meeting.groupId && known.has(meeting.groupId)) return undefined
          if (firstMatchingGroup(groups, subjectOf(meeting))?.id !== id) return undefined
          applied += 1
          return id
        }
      )
      if (!result.ok) {
        this.deps.log?.(
          `[grupos] não aplicou as regras em ${candidate.folder}: ${result.error.message}`
        )
      }
      await this.deps.refresh(candidate.folder)
    }
    return applied
  }

  /**
   * Reunião nova (fim da gravação ou Recuperação), ou que o usuário acabou de nomear: entra no
   * primeiro grupo automático que combina, se ainda não tem grupo. Devolve o grupo em que ela
   * ficou (o que já tinha, se tinha), ou `null`.
   */
  async autoAssign(folder: string): Promise<Result<{ groupId: string | null }>> {
    const read = await this.deps.store.read()
    if (!read.ok) return fail('unknown', read.message)
    const { groups } = read.file
    if (groups.length === 0) return { ok: true, value: { groupId: null } }
    const known = new Set(groups.map((group) => group.id))
    const result = await editMeetingGroup(this.deps.meetingsDir(), folder, (meeting) => {
      if (meeting.groupId && known.has(meeting.groupId)) return undefined
      return firstMatchingGroup(groups, subjectOf(meeting))?.id ?? undefined
    })
    if (!result.ok) return result
    const groupId = result.value !== null && known.has(result.value) ? result.value : null
    await this.deps.refresh(folder)
    this.deps.emitChanged()
    return { ok: true, value: { groupId } }
  }

  /** Fim da gravação: a Reunião recém-gravada entra no grupo que as regras indicarem. */
  onRecordingState(state: RecordingState): void {
    if (state.phase === this.lastPhase) return
    this.lastPhase = state.phase
    const finished = state.phase === 'idle' ? state.finished : null
    if (finished?.status !== 'ready') return
    void this.autoAssign(finished.folder).then((result) => {
      if (!result.ok) this.deps.log?.(`[grupos] sem grupo automático: ${result.error.message}`)
    })
  }

  // --- Sugestões -------------------------------------------------------------------------------

  async acceptSuggestion(id: string): Promise<Result<GroupWithApplied>> {
    const read = await this.deps.store.read()
    if (!read.ok) return fail('unknown', read.message)
    const ungrouped = (await this.deps.meetings()).filter(
      (meeting) => meeting.status === 'ready' && !meeting.groupId
    )
    const suggestion = this.suggestions(read.file.groups, read.file.dismissed, ungrouped).find(
      (item) => item.id === id
    )
    if (!suggestion) return fail('not-found', 'Essa sugestão não vale mais.')
    return this.add({ name: suggestion.name, description: '', rules: suggestion.rules }, true)
  }

  async dismissSuggestion(id: string): Promise<Result<null>> {
    if (typeof id !== 'string' || id === '' || id.length > 200) {
      return fail('invalid-request', 'Pedido inválido.')
    }
    const saved = await this.deps.store.update((file) =>
      file.dismissed.includes(id) ? null : { ...file, dismissed: [...file.dismissed, id] }
    )
    if (!saved.ok) return saved
    this.deps.emitChanged()
    return { ok: true, value: null }
  }
}
