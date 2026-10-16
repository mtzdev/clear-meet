import { readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import {
  CHAT_FILE,
  CHAT_SCHEMA_VERSION,
  MAX_STORED_MESSAGES,
  parseChatText,
  serializeChat,
  type ChatMessage
} from '@shared/chat'
import type { RecordingError, Result } from '@shared/recording'
import { writeFileAtomic } from '../fs/atomic'
import { withFolderLock } from './repository'

function fail(code: RecordingError['code'], message: string): { ok: false; error: RecordingError } {
  return { ok: false, error: { code, message } }
}

/** Mensagens da Conversa (`chat.json`); sem arquivo, lista vazia. */
export async function readChat(folder: string): Promise<Result<ChatMessage[]>> {
  let text: string
  try {
    text = await readFile(join(folder, CHAT_FILE), 'utf8')
  } catch {
    return { ok: true, value: [] }
  }
  const parsed = parseChatText(text)
  return parsed.ok
    ? { ok: true, value: parsed.value.messages }
    : fail('invalid-request', `Não foi possível ler a Conversa: ${parsed.error}.`)
}

/** Acrescenta uma mensagem sob a trava da pasta; as mais antigas além do limite saem. */
export function appendChatMessage(
  folder: string,
  message: ChatMessage
): Promise<Result<ChatMessage[]>> {
  return withFolderLock(folder, async () => {
    const current = await readChat(folder)
    if (!current.ok) return current
    const messages = [...current.value, message].slice(-MAX_STORED_MESSAGES)
    try {
      await writeFileAtomic(
        join(folder, CHAT_FILE),
        serializeChat({ schemaVersion: CHAT_SCHEMA_VERSION, messages })
      )
    } catch {
      return fail('unknown', 'Não foi possível salvar a Conversa no disco.')
    }
    return { ok: true, value: messages }
  })
}

/** Apaga a Conversa (inclusive um `chat.json` ilegível). */
export function clearChat(folder: string): Promise<Result<null>> {
  return withFolderLock(folder, async () => {
    try {
      await rm(join(folder, CHAT_FILE), { force: true })
    } catch {
      return fail('unknown', 'Não foi possível apagar a Conversa.')
    }
    return { ok: true, value: null }
  })
}
