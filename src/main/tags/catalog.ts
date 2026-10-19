import { readFile } from 'node:fs/promises'
import { parseTagList, renameInList, withoutTag, withTag } from '@shared/tags'
import { writeFileAtomic } from '../fs/atomic'

export const TAGS_FILE = 'tags.json'
const TAGS_SCHEMA_VERSION = 1

/**
 * Catálogo de Tags em `userData`: guarda as Tags que nenhuma Reunião usa (no momento). As
 * Reuniões levam as próprias Tags no `meeting.json`, então perder este arquivo não perde nada
 * além das Tags vazias. Escrita atômica, em fila.
 */
export class TagCatalog {
  private names: string[] | null = null
  private chain: Promise<unknown> = Promise.resolve()

  constructor(private readonly file: string) {}

  private async load(): Promise<string[]> {
    if (this.names) return this.names
    try {
      const raw: unknown = JSON.parse((await readFile(this.file, 'utf8')).replace(/^\uFEFF/, ''))
      const tags = typeof raw === 'object' && raw !== null ? (raw as { tags?: unknown }).tags : null
      this.names = parseTagList(tags)
    } catch {
      this.names = []
    }
    return this.names
  }

  async list(): Promise<string[]> {
    await this.chain
    return [...(await this.load())]
  }

  /** Aplica `change` à lista e grava se ela mudou. */
  update(change: (names: string[]) => string[]): Promise<void> {
    const run = this.chain.then(async () => {
      const current = await this.load()
      const next = change(current)
      if (next.length === current.length && next.every((name, i) => name === current[i])) return
      await writeFileAtomic(
        this.file,
        `${JSON.stringify({ schemaVersion: TAGS_SCHEMA_VERSION, tags: next }, null, 2)}\n`
      )
      this.names = next
    })
    this.chain = run.catch(() => undefined)
    return run
  }

  add(name: string): Promise<void> {
    return this.update((names) => withTag(names, name))
  }

  remove(name: string): Promise<void> {
    return this.update((names) => withoutTag(names, name))
  }

  /** Troca `from` por `to` (ou junta as duas, se `to` já existe). */
  rename(from: string, to: string): Promise<void> {
    return this.update((names) => withTag(renameInList(names, from, to), to))
  }
}
