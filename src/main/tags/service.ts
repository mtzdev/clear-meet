import { meetingTags } from '@shared/meeting'
import type { RecordingError, Result } from '@shared/recording'
import {
  canonicalTag,
  checkTagName,
  cleanTagName,
  effectiveTags,
  hasTag,
  MAX_TAGS_PER_MEETING,
  renameInList,
  tagKey,
  withoutTag,
  withTag,
  type TagInfo
} from '@shared/tags'
import { listMeetingFolders, readMeeting } from '../meetings/repository'
import { editMeetingTags } from '../meetings/tags-store'
import type { TagCatalog } from './catalog'

export interface TagServiceDeps {
  catalog: TagCatalog
  meetingsDir(): string
  /** Tags usadas pelas Reuniões do índice, com contagem. */
  indexed(): Promise<TagInfo[]>
  /** Reindexa a pasta depois de alterada. */
  refresh(folder: string): Promise<void>
  /** O catálogo ou o índice mudou: as telas consultam de novo. */
  emitChanged(): void
}

function fail(code: RecordingError['code'], message: string): { ok: false; error: RecordingError } {
  return { ok: false, error: { code, message } }
}

const BUSY_BATCH =
  'Há uma Reunião com esta Tag sendo gravada ou processada. Tente de novo quando terminar.'

interface Holder {
  folder: string
  ready: boolean
}

/**
 * Tags: catálogo em `userData` mais as Tags de cada `meeting.json`. As alterações em várias
 * Reuniões (renomear, apagar) passam pela fila de cada pasta e leem os arquivos, não o índice.
 * Se alguma Reunião afetada ainda está gravando ou processando, a operação inteira é recusada.
 */
export class TagService {
  constructor(private readonly deps: TagServiceDeps) {}

  /** Catálogo efetivo (catálogo mais Tags das Reuniões), com a contagem de cada Tag. */
  async list(): Promise<TagInfo[]> {
    return effectiveTags(await this.deps.catalog.list(), await this.deps.indexed())
  }

  private async knownNames(): Promise<string[]> {
    return (await this.list()).map((tag) => tag.name)
  }

  async create(rawName: string): Promise<Result<TagInfo>> {
    const known = await this.knownNames()
    const checked = checkTagName(rawName, known)
    if (!checked.ok) return fail('invalid-request', checked.message)
    const name = canonicalTag(known, checked.name)
    await this.deps.catalog.add(name)
    this.deps.emitChanged()
    const existing = (await this.list()).find((tag) => tag.name === name)
    return { ok: true, value: existing ?? { name, count: 0 } }
  }

  async add(folder: string, rawName: string): Promise<Result<string[]>> {
    const known = await this.knownNames()
    const checked = checkTagName(rawName, known)
    if (!checked.ok) return fail('invalid-request', checked.message)
    const name = canonicalTag(known, checked.name)
    let full = false
    const result = await editMeetingTags(this.deps.meetingsDir(), folder, (tags) => {
      if (hasTag(tags, name)) return null
      full = tags.length >= MAX_TAGS_PER_MEETING
      return full ? null : withTag(tags, name)
    })
    if (full) {
      return fail('invalid-request', `Máximo de ${MAX_TAGS_PER_MEETING} Tags por Reunião.`)
    }
    if (result.ok) {
      await this.deps.catalog.add(name)
      await this.deps.refresh(folder)
      this.deps.emitChanged()
    }
    return result
  }

  async remove(folder: string, rawName: string): Promise<Result<string[]>> {
    const checked = cleanTagName(rawName)
    if (!checked.ok) return fail('invalid-request', checked.message)
    let spelling = checked.name
    const result = await editMeetingTags(this.deps.meetingsDir(), folder, (tags) => {
      if (!hasTag(tags, checked.name)) return null
      spelling = tags.find((tag) => tagKey(tag) === tagKey(checked.name)) ?? spelling
      return withoutTag(tags, checked.name)
    })
    if (result.ok) {
      // A Tag continua existindo, mesmo sem nenhuma Reunião, até ser apagada.
      await this.deps.catalog.add(spelling)
      await this.deps.refresh(folder)
      this.deps.emitChanged()
    }
    return result
  }

  /**
   * Renomeia a Tag em todas as Reuniões. Se `to` é outra Tag que já existe, as duas viram uma
   * só (vale a grafia da que já existia).
   */
  async rename(rawFrom: string, rawTo: string): Promise<Result<{ name: string; updated: number }>> {
    const from = cleanTagName(rawFrom)
    const to = checkTagName(rawTo, await this.knownNames())
    if (!from.ok) return fail('invalid-request', from.message)
    if (!to.ok) return fail('invalid-request', to.message)
    const target =
      tagKey(from.name) === tagKey(to.name)
        ? to.name
        : canonicalTag(await this.knownNames(), to.name)

    const holders = await this.holders(from.name)
    if (holders.some((holder) => !holder.ready)) return fail('busy', BUSY_BATCH)
    const outcome = await this.applyToAll(holders, (tags) =>
      hasTag(tags, from.name) ? renameInList(tags, from.name, target) : null
    )
    await this.deps.catalog.rename(from.name, target)
    this.deps.emitChanged()
    return outcome.failed > 0
      ? fail('unknown', failedText(outcome.failed))
      : { ok: true, value: { name: target, updated: outcome.updated } }
  }

  /** Apaga a Tag do catálogo e de todas as Reuniões. */
  async delete(rawName: string): Promise<Result<{ updated: number }>> {
    const checked = cleanTagName(rawName)
    if (!checked.ok) return fail('invalid-request', checked.message)
    const holders = await this.holders(checked.name)
    if (holders.some((holder) => !holder.ready)) return fail('busy', BUSY_BATCH)
    const outcome = await this.applyToAll(holders, (tags) =>
      hasTag(tags, checked.name) ? withoutTag(tags, checked.name) : null
    )
    // Com falhas, a Tag continua nas Reuniões que não saíram e reaparece no catálogo efetivo.
    await this.deps.catalog.remove(checked.name)
    this.deps.emitChanged()
    return outcome.failed > 0
      ? fail('unknown', failedText(outcome.failed))
      : { ok: true, value: { updated: outcome.updated } }
  }

  /** Pastas cujo `meeting.json` tem a Tag (lido do disco, que é a fonte da verdade). */
  private async holders(name: string): Promise<Holder[]> {
    const key = tagKey(name)
    const found: Holder[] = []
    for (const folder of await listMeetingFolders(this.deps.meetingsDir())) {
      const read = await readMeeting(folder)
      if (!read.ok) continue
      if (meetingTags(read.value).some((tag) => tagKey(tag) === key)) {
        found.push({ folder, ready: read.value.status === 'ready' })
      }
    }
    return found
  }

  private async applyToAll(
    holders: readonly Holder[],
    change: (tags: string[]) => string[] | null
  ): Promise<{ updated: number; failed: number }> {
    let updated = 0
    let failed = 0
    for (const holder of holders) {
      const result = await editMeetingTags(this.deps.meetingsDir(), holder.folder, change)
      if (result.ok) updated += 1
      else failed += 1
      await this.deps.refresh(holder.folder)
    }
    return { updated, failed }
  }
}

function failedText(count: number): string {
  return count === 1
    ? 'Uma Reunião não pôde ser atualizada. Tente de novo.'
    : `${count} Reuniões não puderam ser atualizadas. Tente de novo.`
}
