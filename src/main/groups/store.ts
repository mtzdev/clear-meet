import { mkdir, readFile, rename, rm } from 'node:fs/promises'
import { join } from 'node:path'
import {
  EMPTY_GROUPS_FILE,
  GROUPS_DIR,
  GROUPS_FILE,
  parseGroupsFile,
  serializeGroupsFile,
  type GroupsFile
} from '@shared/groups'
import type { Result } from '@shared/recording'
import { writeFileAtomic } from '../fs/atomic'

const CORRUPT_FILE = 'groups.corrupt.json'
const UNREADABLE = 'Não foi possível ler os grupos desta pasta. Confira as permissões da pasta.'
const READ_ONLY =
  'A pasta das Reuniões não permite gravar. Os grupos ficam disponíveis só para consulta.'
const WRITE_FAILED = 'Não foi possível salvar os grupos no disco.'

export type GroupsRead =
  { ok: true; file: GroupsFile; corrupt: boolean } | { ok: false; message: string }

function errorCode(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException | undefined)?.code
}

const DENIED = new Set(['EACCES', 'EPERM', 'EROFS'])

function writeMessage(error: unknown): string {
  const code = errorCode(error)
  return code !== undefined && DENIED.has(code) ? READ_ONLY : WRITE_FAILED
}

/**
 * Definição dos grupos em `<pasta das Reuniões>/.clearmeet/groups.json`. Nada fica em cache: o
 * arquivo é pequeno, pode ter vindo de outro PC e a pasta das Reuniões pode mudar. Leitura
 * tolerante; escrita atômica em fila. Se a pasta não deixa ler ou gravar, os grupos ficam
 * indisponíveis (com mensagem) sem afetar o resto do app.
 */
export class GroupStore {
  private chain: Promise<unknown> = Promise.resolve()
  private writeError: string | null = null

  constructor(private readonly root: () => string) {}

  private dir(): string {
    return join(this.root(), GROUPS_DIR)
  }

  private file(): string {
    return join(this.dir(), GROUPS_FILE)
  }

  /** Ids dos grupos que existem; vazio se a definição não pode ser lida. */
  async ids(): Promise<string[]> {
    const read = await this.read()
    return read.ok ? read.file.groups.map((group) => group.id) : []
  }

  async read(): Promise<GroupsRead> {
    let text: string
    try {
      text = await readFile(this.file(), 'utf8')
    } catch (error) {
      if (errorCode(error) === 'ENOENT' || errorCode(error) === 'ENOTDIR') {
        return { ok: true, file: structuredClone(EMPTY_GROUPS_FILE), corrupt: false }
      }
      return { ok: false, message: UNREADABLE }
    }
    try {
      const raw: unknown = JSON.parse(text.replace(/^\uFEFF/, ''))
      return { ok: true, file: parseGroupsFile(raw), corrupt: false }
    } catch {
      return { ok: true, file: structuredClone(EMPTY_GROUPS_FILE), corrupt: true }
    }
  }

  /**
   * Se dá para alterar os grupos. Com `recheck`, tenta gravar de verdade; sem ele, vale o
   * resultado da última escrita.
   */
  async status(recheck: boolean): Promise<{ editable: boolean; message: string | null }> {
    if (recheck) await this.probe()
    return { editable: this.writeError === null, message: this.writeError }
  }

  private probe(): Promise<void> {
    const run = this.chain.then(async () => {
      const probe = join(this.dir(), `.teste-${process.pid}.tmp`)
      try {
        await mkdir(this.dir(), { recursive: true })
        await writeFileAtomic(probe, '')
        await rm(probe, { force: true })
        this.writeError = null
      } catch (error) {
        this.writeError = writeMessage(error)
      }
    })
    this.chain = run.catch(() => undefined)
    return run
  }

  /**
   * Aplica `change` ao arquivo e grava se mudou. `change` devolve o novo conteúdo, `null` se nada
   * muda ou um texto (o motivo de recusar). Um arquivo ilegível é guardado como
   * `groups.corrupt.json` antes de ser substituído.
   */
  update(change: (file: GroupsFile) => GroupsFile | string | null): Promise<Result<GroupsFile>> {
    const run = this.chain.then(async (): Promise<Result<GroupsFile>> => {
      const read = await this.read()
      if (!read.ok) return { ok: false, error: { code: 'unknown', message: read.message } }
      const next = change(read.file)
      if (typeof next === 'string') {
        return { ok: false, error: { code: 'invalid-request', message: next } }
      }
      if (next === null) return { ok: true, value: read.file }
      try {
        await mkdir(this.dir(), { recursive: true })
        if (read.corrupt) {
          await rename(this.file(), join(this.dir(), CORRUPT_FILE)).catch(() => undefined)
        }
        await writeFileAtomic(this.file(), serializeGroupsFile(next))
      } catch (error) {
        this.writeError = writeMessage(error)
        return { ok: false, error: { code: 'unknown', message: this.writeError } }
      }
      this.writeError = null
      return { ok: true, value: next }
    })
    this.chain = run.catch(() => undefined)
    return run
  }
}
