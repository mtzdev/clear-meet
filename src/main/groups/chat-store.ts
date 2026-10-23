import { mkdir, readFile, rename, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { GROUPS_DIR } from '@shared/groups'
import {
  EMPTY_GROUP_CHAT,
  GROUP_CHATS_DIR,
  parseGroupChat,
  serializeGroupChat,
  type GroupChatFile
} from '@shared/group-chat'
import type { Result } from '@shared/recording'
import { writeFileAtomic } from '../fs/atomic'

const READ_ONLY = 'A pasta das Reuniões não permite gravar. A Conversa do grupo não pode ser salva.'
const WRITE_FAILED = 'Não foi possível salvar a Conversa do grupo no disco.'
const UNREADABLE = 'Não foi possível ler a Conversa do grupo. Confira as permissões da pasta.'
const DENIED = new Set(['EACCES', 'EPERM', 'EROFS'])
const SAFE_ID = /^[A-Za-z0-9_-]{1,100}$/

export type GroupChatRead =
  { ok: true; chat: GroupChatFile; corrupt: boolean } | { ok: false; message: string }

function errorCode(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException | undefined)?.code
}

function emptyChat(): GroupChatFile {
  return structuredClone(EMPTY_GROUP_CHAT)
}

/**
 * Conversas dos grupos em `<pasta das Reuniões>/.clearmeet/chats/<id do grupo>.json`. Nada fica
 * em cache (a pasta pode mudar ou vir de outro PC); leitura tolerante, escrita atômica em fila.
 * Um arquivo ilegível vira `<id>.corrupt.json` antes de ser substituído.
 */
export class GroupChatStore {
  private chain: Promise<unknown> = Promise.resolve()

  constructor(private readonly root: () => string) {}

  private dir(): string {
    return join(this.root(), GROUPS_DIR, GROUP_CHATS_DIR)
  }

  private file(groupId: string): string {
    return join(this.dir(), `${groupId}.json`)
  }

  static validId(groupId: unknown): groupId is string {
    return typeof groupId === 'string' && SAFE_ID.test(groupId)
  }

  async read(groupId: string): Promise<GroupChatRead> {
    if (!GroupChatStore.validId(groupId)) return { ok: false, message: UNREADABLE }
    let text: string
    try {
      text = await readFile(this.file(groupId), 'utf8')
    } catch (error) {
      if (errorCode(error) === 'ENOENT' || errorCode(error) === 'ENOTDIR') {
        return { ok: true, chat: emptyChat(), corrupt: false }
      }
      return { ok: false, message: UNREADABLE }
    }
    try {
      const parsed = parseGroupChat(JSON.parse(text.replace(/^\uFEFF/, '')))
      if (parsed) return { ok: true, chat: parsed, corrupt: false }
    } catch {
      // cai no arquivo ilegível abaixo
    }
    return { ok: true, chat: emptyChat(), corrupt: true }
  }

  /**
   * Aplica `change` e grava se mudou. `change` devolve o novo conteúdo, `null` se nada muda ou um
   * texto (o motivo de recusar).
   */
  update(
    groupId: string,
    change: (chat: GroupChatFile) => GroupChatFile | string | null
  ): Promise<Result<GroupChatFile>> {
    const run = this.chain.then(async (): Promise<Result<GroupChatFile>> => {
      const read = await this.read(groupId)
      if (!read.ok) return { ok: false, error: { code: 'unknown', message: read.message } }
      const next = change(read.chat)
      if (typeof next === 'string') {
        return { ok: false, error: { code: 'invalid-request', message: next } }
      }
      if (next === null) return { ok: true, value: read.chat }
      try {
        await mkdir(this.dir(), { recursive: true })
        if (read.corrupt) {
          await rename(this.file(groupId), join(this.dir(), `${groupId}.corrupt.json`)).catch(
            () => undefined
          )
        }
        await writeFileAtomic(this.file(groupId), serializeGroupChat(next))
      } catch (error) {
        const denied = DENIED.has(errorCode(error) ?? '')
        return { ok: false, error: { code: 'unknown', message: denied ? READ_ONLY : WRITE_FAILED } }
      }
      return { ok: true, value: next }
    })
    this.chain = run.catch(() => undefined)
    return run
  }

  /** Apaga a Conversa do grupo (e um arquivo ilegível guardado dela). */
  remove(groupId: string): Promise<Result<null>> {
    const run = this.chain.then(async (): Promise<Result<null>> => {
      if (!GroupChatStore.validId(groupId)) return { ok: true, value: null }
      try {
        await rm(this.file(groupId), { force: true })
        await rm(join(this.dir(), `${groupId}.corrupt.json`), { force: true })
      } catch {
        return {
          ok: false,
          error: { code: 'unknown', message: 'Não foi possível apagar a Conversa do grupo.' }
        }
      }
      return { ok: true, value: null }
    })
    this.chain = run.catch(() => undefined)
    return run
  }
}
