import { readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CHAT_FILE, MAX_STORED_MESSAGES, type ChatMessage } from '@shared/chat'
import { tempMeetings, type TempMeetings } from '../ai/testing'
import { appendChatMessage, clearChat, readChat } from './chat-store'

let dir: TempMeetings
beforeEach(async () => {
  dir = await tempMeetings()
})
afterEach(async () => {
  await dir.cleanup()
})

const message = (id: string, role: 'user' | 'assistant' = 'user'): ChatMessage => ({
  id,
  role,
  text: `texto ${id}`,
  createdAt: '2026-10-13T13:00:00.000Z',
  ...(role === 'assistant' ? { provider: 'groq' as const, model: 'm' } : {})
})

describe('chat-store', () => {
  it('sem chat.json a Conversa está vazia', async () => {
    expect(await readChat(dir.folder)).toEqual({ ok: true, value: [] })
  })

  it('acrescenta mensagens em ordem e as relê do disco, sem sobrar temporários', async () => {
    await appendChatMessage(dir.folder, message('1'))
    const result = await appendChatMessage(dir.folder, message('2', 'assistant'))
    expect(result.ok && result.value.map((m) => m.id)).toEqual(['1', '2'])
    expect(await readChat(dir.folder)).toEqual({
      ok: true,
      value: [message('1'), message('2', 'assistant')]
    })
    expect((await readdir(dir.folder)).filter((name) => name.includes('tmp'))).toEqual([])
  })

  it('escritas simultâneas não perdem mensagens', async () => {
    await Promise.all(
      Array.from({ length: 12 }, (_, i) => appendChatMessage(dir.folder, message(`m${i}`)))
    )
    const chat = await readChat(dir.folder)
    expect(chat.ok && chat.value).toHaveLength(12)
  })

  it('guarda só as últimas mensagens', async () => {
    for (let i = 0; i < MAX_STORED_MESSAGES + 3; i++) {
      await appendChatMessage(dir.folder, message(`m${i}`))
    }
    const chat = await readChat(dir.folder)
    expect(chat.ok && chat.value).toHaveLength(MAX_STORED_MESSAGES)
    expect(chat.ok && chat.value[0]?.id).toBe('m3')
  })

  it('arquivo ilegível é erro na leitura e some ao limpar', async () => {
    await writeFile(join(dir.folder, CHAT_FILE), '{ quebrado')
    expect(await readChat(dir.folder)).toMatchObject({ ok: false })
    expect(await appendChatMessage(dir.folder, message('1'))).toMatchObject({ ok: false })
    expect(await clearChat(dir.folder)).toEqual({ ok: true, value: null })
    expect(await readChat(dir.folder)).toEqual({ ok: true, value: [] })
  })

  it('limpar uma Conversa inexistente não falha', async () => {
    expect(await clearChat(dir.folder)).toEqual({ ok: true, value: null })
  })
})
