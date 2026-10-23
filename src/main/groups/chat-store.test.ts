import { chmod, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { EMPTY_GROUP_CHAT, type GroupChatMessage } from '@shared/group-chat'
import { GroupChatStore } from './chat-store'

let root: string
let store: GroupChatStore

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'clearmeet-chat-grupo-'))
  store = new GroupChatStore(() => root)
})
afterEach(async () => {
  await chmod(root, 0o755).catch(() => undefined)
  await rm(root, { recursive: true, force: true })
})

const chatsDir = () => join(root, '.clearmeet', 'chats')
const message = (id: string, text = 'oi'): GroupChatMessage => ({
  id,
  role: 'user',
  text,
  createdAt: '2026-10-21T12:00:00.000Z'
})

describe('GroupChatStore', () => {
  it('sem arquivo, devolve a Conversa vazia com o escopo padrão', async () => {
    const read = await store.read('g1')
    expect(read).toEqual({ ok: true, chat: EMPTY_GROUP_CHAT, corrupt: false })
  })

  it('grava em .clearmeet/chats/<id>.json e lê de volta', async () => {
    const saved = await store.update('g1', (chat) => ({
      ...chat,
      labels: { a: 1 },
      messages: [message('m1')]
    }))
    expect(saved.ok).toBe(true)
    expect(await readdir(chatsDir())).toEqual(['g1.json'])
    const read = await store.read('g1')
    expect(read.ok && read.chat.messages.map((item) => item.id)).toEqual(['m1'])
    expect(read.ok && read.chat.labels).toEqual({ a: 1 })
  })

  it('o conteúdo é JSON estável com schema e escopo', async () => {
    await store.update('g1', (chat) => ({ ...chat, messages: [message('m1')] }))
    const file = JSON.parse(await readFile(join(chatsDir(), 'g1.json'), 'utf8')) as Record<
      string,
      unknown
    >
    expect(file.schemaVersion).toBe(1)
    expect(file.scope).toEqual({ periodDays: 30, maxMeetings: 5, include: [], exclude: [] })
  })

  it('cada alteração parte do que está no disco, mesmo em série rápida', async () => {
    await Promise.all(
      ['a', 'b', 'c', 'd'].map((id) =>
        store.update('g1', (chat) => ({ ...chat, messages: [...chat.messages, message(id)] }))
      )
    )
    const read = await store.read('g1')
    expect(read.ok && read.chat.messages.map((item) => item.id).sort()).toEqual([
      'a',
      'b',
      'c',
      'd'
    ])
  })

  it('devolve o motivo de recusa sem gravar e `null` não escreve nada', async () => {
    const refused = await store.update('g1', () => 'não pode')
    expect(refused).toMatchObject({ ok: false, error: { message: 'não pode' } })
    expect((await store.update('g1', () => null)).ok).toBe(true)
    await expect(readdir(chatsDir())).rejects.toThrow()
  })

  it('arquivo ilegível vira corrupt.json e a Conversa recomeça vazia', async () => {
    await mkdir(chatsDir(), { recursive: true })
    await writeFile(join(chatsDir(), 'g1.json'), '{ quebrado')
    const read = await store.read('g1')
    expect(read).toMatchObject({ ok: true, corrupt: true })
    await store.update('g1', (chat) => ({ ...chat, messages: [message('m1')] }))
    expect((await readdir(chatsDir())).sort()).toEqual(['g1.corrupt.json', 'g1.json'])
    expect(await readFile(join(chatsDir(), 'g1.corrupt.json'), 'utf8')).toBe('{ quebrado')
  })

  it('arquivo de outra versão também é tratado como ilegível', async () => {
    await mkdir(chatsDir(), { recursive: true })
    await writeFile(join(chatsDir(), 'g1.json'), JSON.stringify({ schemaVersion: 9 }))
    expect(await store.read('g1')).toMatchObject({ ok: true, corrupt: true })
  })

  it('mensagens quebradas são descartadas e as boas continuam', async () => {
    await mkdir(chatsDir(), { recursive: true })
    await writeFile(
      join(chatsDir(), 'g1.json'),
      JSON.stringify({ schemaVersion: 1, messages: [message('m1'), { id: 'x' }] })
    )
    const read = await store.read('g1')
    expect(read.ok && read.chat.messages.map((item) => item.id)).toEqual(['m1'])
  })

  it('cada grupo tem o seu arquivo e `remove` apaga só o dele', async () => {
    await store.update('g1', (chat) => ({ ...chat, messages: [message('m1')] }))
    await store.update('g2', (chat) => ({ ...chat, messages: [message('m2')] }))
    await mkdir(chatsDir(), { recursive: true })
    await writeFile(join(chatsDir(), 'g1.corrupt.json'), 'lixo')
    expect((await store.remove('g1')).ok).toBe(true)
    expect(await readdir(chatsDir())).toEqual(['g2.json'])
    expect((await store.remove('g1')).ok).toBe(true)
  })

  it('recusa ids que sairiam da pasta de Conversas', async () => {
    expect((await store.read('../groups')).ok).toBe(false)
    const update = await store.update('..\\x', (chat) => chat)
    expect(update.ok).toBe(false)
    expect((await store.remove('../x')).ok).toBe(true)
    expect(GroupChatStore.validId('780fa3a7-c00d-4d52-a7f3-a5cbfbfe689b')).toBe(true)
    expect(GroupChatStore.validId('a/b')).toBe(false)
  })

  it('pasta em que não dá para gravar: aviso claro, sem lançar', async () => {
    // Um arquivo no lugar de `.clearmeet` impede criar a pasta (vale também no Windows).
    await writeFile(join(root, '.clearmeet'), 'x')
    const saved = await store.update('g1', (chat) => ({ ...chat, messages: [message('m1')] }))
    expect(saved).toMatchObject({ ok: false, error: { code: 'unknown' } })
    expect(saved.ok ? '' : saved.error.message).toMatch(/Conversa do grupo/)
  })

  it('lê a pasta das Reuniões atual a cada chamada (a pasta pode mudar)', async () => {
    const other = await mkdtemp(join(tmpdir(), 'clearmeet-chat-grupo-'))
    try {
      let current = root
      const moving = new GroupChatStore(() => current)
      await moving.update('g1', (chat) => ({ ...chat, messages: [message('m1')] }))
      current = other
      const read = await moving.read('g1')
      expect(read.ok && read.chat.messages).toEqual([])
    } finally {
      await rm(other, { recursive: true, force: true })
    }
  })
})
