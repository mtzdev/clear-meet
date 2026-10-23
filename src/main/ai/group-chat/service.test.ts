import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MAX_QUESTION_LENGTH } from '@shared/chat'
import type { GroupChatEvent, MeetingRelevance } from '@shared/group-chat'
import { serializeMeeting } from '@shared/meeting'
import { serializeTranscript, TRANSCRIPT_FILE } from '@shared/transcript'
import { GroupChatStore } from '../../groups/chat-store'
import type { GroupMeetingRef } from '../../library/service'
import { AiError } from '../errors'
import { meetingFile, transcriptFile } from '../testing'
import type { TextHooks, TextRequest, TextResult } from '../text/types'
import type { ChatTextRouter } from '../chat/answer'
import { GroupChatService } from './service'

const NOW = Date.parse('2026-10-21T15:00:00.000Z')
const DAY = 86_400_000
const GROUP = 'g1'

let root: string
let events: GroupChatEvent[]
let refs: GroupMeetingRef[]

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'clearmeet-conversa-grupo-'))
  events = []
  refs = []
})
afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

async function addMeeting(
  id: string,
  daysAgo: number,
  options: { transcript?: boolean; name?: string } = {}
): Promise<GroupMeetingRef> {
  const folder = join(root, id)
  await mkdir(folder)
  const hasTranscript = options.transcript !== false
  const createdAt = new Date(NOW - daysAgo * DAY).toISOString()
  const name = options.name ?? `Reunião ${id}`
  await writeFile(
    join(folder, 'meeting.json'),
    serializeMeeting(
      meetingFile({
        id,
        name,
        createdAt,
        ...(hasTranscript ? {} : { transcript: undefined })
      })
    )
  )
  if (hasTranscript) {
    await writeFile(
      join(folder, TRANSCRIPT_FILE),
      serializeTranscript(
        transcriptFile({
          utterances: [
            { id: 'u1', speakerId: 's1', startMs: 5000, text: `Decisão da ${id}: adiar.` },
            { id: 'u2', speakerId: 's2', startMs: 65_000, text: 'Concordo, fica para novembro.' }
          ]
        })
      )
    )
  }
  const ref: GroupMeetingRef = {
    id,
    folder,
    name,
    createdAt,
    durationMs: 600_000,
    hasTranscript
  }
  refs.push(ref)
  return ref
}

type Responder = (
  request: TextRequest,
  signal: AbortSignal,
  hooks: TextHooks,
  call: number
) => Promise<Partial<TextResult> & { text: string }>

function fakeRouter(respond: Responder, hasProvider = true) {
  const requests: TextRequest[] = []
  const router: ChatTextRouter = {
    hasProvider: () => hasProvider,
    run: async (request, signal, hooks = {}) => {
      requests.push(request)
      const result = await respond(request, signal, hooks, requests.length)
      return { truncated: false, provider: 'groq', model: 'openai/gpt-oss-120b', ...result }
    }
  }
  return { router, requests }
}

const streaming =
  (...parts: string[]): Responder =>
  (_request, _signal, hooks) => {
    for (const part of parts) hooks.onDelta?.(part)
    return Promise.resolve({ text: parts.join('') })
  }

let ids = 0
function makeService(
  router: ChatTextRouter,
  options: {
    logs?: string[]
    relevance?: (ids: string[], fts: string) => Promise<Map<string, MeetingRelevance>>
    relevanceCalls?: string[]
  } = {}
): { service: GroupChatService; store: GroupChatStore } {
  const store = new GroupChatStore(() => root)
  const service = new GroupChatService({
    store,
    groupExists: (id) => Promise.resolve(id === GROUP),
    meetings: () =>
      Promise.resolve([...refs].sort((a, b) => b.createdAt.localeCompare(a.createdAt))),
    relevance: (meetingIds, fts) => {
      options.relevanceCalls?.push(fts)
      return options.relevance
        ? options.relevance(meetingIds, fts)
        : Promise.resolve(new Map<string, MeetingRelevance>())
    },
    router,
    emit: (event) => events.push(event),
    now: () => NOW,
    newId: () => `id-${++ids}`,
    log: (message) => options.logs?.push(message)
  })
  return { service, store }
}

async function settled(service: GroupChatService): Promise<void> {
  for (let i = 0; i < 400 && service.isActive(GROUP); i++) {
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  expect(service.isActive(GROUP)).toBe(false)
}

describe('GroupChatService.send', () => {
  it('grava a pergunta, transmite aos poucos e grava a resposta com provedor e escopo usado', async () => {
    await addMeeting('a', 1)
    await addMeeting('b', 3)
    const { router, requests } = fakeRouter(streaming('Adiaram ', 'o lançamento [R2 00:05].'))
    const { service, store } = makeService(router)

    const sent = await service.send(GROUP, '  O que foi decidido?  ')
    expect(sent.ok).toBe(true)
    if (!sent.ok) return
    expect(sent.value.user).toMatchObject({ role: 'user', text: 'O que foi decidido?' })
    expect(sent.value.scope.map((ref) => [ref.label, ref.id, ref.level])).toEqual([
      [1, 'b', 'full'],
      [2, 'a', 'full']
    ])
    await settled(service)

    expect(events.map((event) => event.type)).toEqual(['delta', 'delta', 'done'])
    expect(events[0]).toMatchObject({ groupId: GROUP, messageId: sent.value.assistantId })

    const read = await store.read(GROUP)
    if (!read.ok) throw new Error('leitura falhou')
    expect(read.chat.messages.map((message) => message.role)).toEqual(['user', 'assistant'])
    const answer = read.chat.messages[1]
    expect(answer).toMatchObject({
      text: 'Adiaram o lançamento [R2 00:05].',
      provider: 'groq',
      model: 'openai/gpt-oss-120b'
    })
    expect(answer?.scope?.map((ref) => ref.id)).toEqual(['b', 'a'])
    expect(read.chat.labels).toEqual({ b: 1, a: 2 })

    const system = requests[0]?.system ?? ''
    expect(system).toContain('VÁRIAS reuniões')
    expect(system).toContain('R1 · Reunião b')
    expect(system).toContain('R2 · Reunião a')
    expect(system).toContain('Decisão da a: adiar.')
    expect(requests[0]?.messages).toEqual([{ role: 'user', content: 'O que foi decidido?' }])
  })

  it('o escopo escolhido define quais Reuniões vão para a IA', async () => {
    await addMeeting('novo', 1)
    await addMeeting('meio', 10)
    await addMeeting('velho', 60)
    const { router, requests } = fakeRouter(streaming('ok'))
    const { service } = makeService(router)

    await service.setScope(GROUP, { periodDays: 7, maxMeetings: 3, include: [], exclude: [] })
    await service.send(GROUP, 'Pergunta')
    await settled(service)
    expect(requests[0]?.system).toContain('Reunião novo')
    expect(requests[0]?.system).not.toContain('Reunião meio')

    await service.setScope(GROUP, {
      periodDays: 7,
      maxMeetings: 3,
      include: ['velho'],
      exclude: ['novo']
    })
    await service.send(GROUP, 'Outra pergunta')
    await settled(service)
    expect(requests[1]?.system).not.toContain('Reunião novo')
    expect(requests[1]?.system).toContain('Reunião velho')
  })

  it('o rótulo de cada Reunião continua o mesmo quando o escopo muda', async () => {
    await addMeeting('a', 1)
    await addMeeting('b', 2)
    const { router, requests } = fakeRouter(streaming('ok'))
    const { service, store } = makeService(router)

    await service.setScope(GROUP, { periodDays: 30, maxMeetings: 3, include: [], exclude: ['a'] })
    await service.send(GROUP, 'Primeira')
    await settled(service)
    expect(requests[0]?.system).toContain('R1 · Reunião b')

    await service.setScope(GROUP, { periodDays: 30, maxMeetings: 3, include: [], exclude: [] })
    await service.send(GROUP, 'Segunda')
    await settled(service)
    expect(requests[1]?.system).toContain('R1 · Reunião b')
    expect(requests[1]?.system).toContain('R2 · Reunião a')
    const read = await store.read(GROUP)
    expect(read.ok && read.chat.labels).toEqual({ b: 1, a: 2 })
  })

  it('Reunião sem Transcrição fica de fora; sem nenhuma com Transcrição recusa', async () => {
    await addMeeting('com', 1)
    await addMeeting('sem', 2, { transcript: false })
    const { router, requests } = fakeRouter(streaming('ok'))
    const { service } = makeService(router)

    await service.send(GROUP, 'Pergunta')
    await settled(service)
    expect(requests[0]?.system).toContain('Reunião com')
    expect(requests[0]?.system).not.toContain('Reunião sem')

    await service.setScope(GROUP, { periodDays: 30, maxMeetings: 3, include: [], exclude: ['com'] })
    const refused = await service.send(GROUP, 'Outra')
    expect(refused).toMatchObject({ ok: false, error: { code: 'invalid-request' } })
    expect(requests).toHaveLength(1)
  })

  it('usa a busca de relevância com as palavras da pergunta e manda a Transcrição inteira às relevantes', async () => {
    await addMeeting('a', 1)
    await addMeeting('b', 2)
    const calls: string[] = []
    const { router } = fakeRouter(streaming('ok'))
    const { service } = makeService(router, {
      relevanceCalls: calls,
      relevance: () => Promise.resolve(new Map([['a', { score: 3, offsets: [5000] }]]))
    })
    await service.send(GROUP, 'O que decidiram sobre o lançamento?')
    await settled(service)
    expect(calls).toEqual(['"decidiram"* OR "lancamento"*'])
  })

  it('falha na busca de relevância não impede a resposta', async () => {
    await addMeeting('a', 1)
    const logs: string[] = []
    const { router, requests } = fakeRouter(streaming('ok'))
    const { service } = makeService(router, {
      logs,
      relevance: () => Promise.reject(new Error('sem FTS'))
    })
    const sent = await service.send(GROUP, 'Pergunta sobre o prazo')
    expect(sent.ok).toBe(true)
    await settled(service)
    expect(requests).toHaveLength(1)
    expect(logs.some((line) => line.includes('relevância'))).toBe(true)
  })

  it('manda só o histórico recente e termina na pergunta atual', async () => {
    await addMeeting('a', 1)
    const { router, requests } = fakeRouter(streaming('resposta'))
    const { service } = makeService(router)
    await service.send(GROUP, 'Primeira')
    await settled(service)
    await service.send(GROUP, 'Segunda')
    await settled(service)
    expect(requests[1]?.messages.map((turn) => turn.content)).toEqual([
      'Primeira',
      'resposta',
      'Segunda'
    ])
  })

  it('parar guarda o que chegou como resposta interrompida; sem texto, não guarda nada', async () => {
    await addMeeting('a', 1)
    const gate = fakeRouter((_request, signal, hooks) => {
      hooks.onDelta?.('Começo ')
      return new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new AiError('cancelled', 'Cancelado.')))
      })
    })
    const { service, store } = makeService(gate.router)
    const sent = await service.send(GROUP, 'Pergunta')
    expect(sent.ok).toBe(true)
    service.stop(GROUP)
    await settled(service)
    expect(events.at(-1)).toMatchObject({
      type: 'done',
      message: { text: 'Começo ', stopped: true }
    })
    const read = await store.read(GROUP)
    expect(read.ok && read.chat.messages.map((message) => message.stopped ?? false)).toEqual([
      false,
      true
    ])

    events = []
    const silent = fakeRouter(
      (_request, signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new AiError('cancelled', 'Cancelado.')))
        })
    )
    const second = makeService(silent.router)
    await second.service.send(GROUP, 'Outra')
    second.service.stop(GROUP)
    await settled(second.service)
    expect(events.at(-1)).toMatchObject({ type: 'done', message: null })
  })

  it('erro da IA vira evento, a pergunta fica e dá para tentar de novo', async () => {
    await addMeeting('a', 1)
    const logs: string[] = []
    const { router } = fakeRouter((_request, _signal, _hooks, call) =>
      call === 1
        ? Promise.reject(new AiError('quota', 'O limite de uso da chave foi atingido.'))
        : Promise.resolve({ text: 'Agora foi.' })
    )
    const { service, store } = makeService(router, { logs })
    const sent = await service.send(GROUP, 'Pergunta')
    expect(sent.ok).toBe(true)
    await settled(service)
    expect(events.at(-1)).toMatchObject({
      type: 'error',
      message: 'O limite de uso da chave foi atingido.'
    })
    expect(logs.some((line) => line.includes('quota'))).toBe(true)
    const afterError = await store.read(GROUP)
    expect(afterError.ok && afterError.chat.messages).toHaveLength(1)

    const retry = await service.send(GROUP, null)
    expect(retry).toMatchObject({ ok: true, value: { user: null } })
    await settled(service)
    const read = await store.read(GROUP)
    expect(read.ok && read.chat.messages.map((message) => message.role)).toEqual([
      'user',
      'assistant'
    ])
  })

  it('resposta vazia é erro; repetir sem pergunta pendente é recusado', async () => {
    await addMeeting('a', 1)
    const { router } = fakeRouter(() => Promise.resolve({ text: '   ' }))
    const { service } = makeService(router)
    expect(await service.send(GROUP, null)).toMatchObject({
      ok: false,
      error: { code: 'invalid-request' }
    })
    await service.send(GROUP, 'Pergunta')
    await settled(service)
    expect(events.at(-1)?.type).toBe('error')
  })

  it('valida pergunta, chave, grupo e uma resposta por vez', async () => {
    await addMeeting('a', 1)
    let release: () => void = () => undefined
    const slow = fakeRouter(
      () =>
        new Promise((resolve) => {
          release = () => resolve({ text: 'fim' })
        })
    )
    const { service } = makeService(slow.router)

    expect(await service.send(GROUP, '   ')).toMatchObject({ ok: false })
    expect(await service.send(GROUP, 'x'.repeat(MAX_QUESTION_LENGTH + 1))).toMatchObject({
      ok: false
    })
    expect(await service.send('outro', 'Pergunta')).toMatchObject({
      ok: false,
      error: { code: 'not-found' }
    })
    expect(service.isActive('outro')).toBe(false)

    const first = await service.send(GROUP, 'Pergunta')
    expect(first.ok).toBe(true)
    expect(await service.send(GROUP, 'Outra')).toMatchObject({ ok: false, error: { code: 'busy' } })
    expect(service.hasActive()).toBe(true)
    release()
    await settled(service)

    const noKey = makeService(fakeRouter(streaming('x'), false).router)
    expect(await noKey.service.send(GROUP, 'Pergunta')).toMatchObject({
      ok: false,
      error: { code: 'no-api-key' }
    })
  })

  it('pasta somente leitura: avisa e não chama a IA', async () => {
    await addMeeting('a', 1)
    await writeFile(join(root, '.clearmeet'), 'arquivo no lugar da pasta')
    const { router, requests } = fakeRouter(streaming('x'))
    const { service } = makeService(router)
    const sent = await service.send(GROUP, 'Pergunta')
    expect(sent).toMatchObject({ ok: false })
    expect(sent.ok ? '' : sent.error.message).toMatch(/Conversa do grupo/)
    expect(requests).toHaveLength(0)
    expect(service.isActive(GROUP)).toBe(false)
  })
})

describe('GroupChatService.get / setScope / clear / discard', () => {
  it('get devolve mensagens, escopo e a resposta em geração com o escopo dela', async () => {
    await addMeeting('a', 1)
    let release: () => void = () => undefined
    const { router } = fakeRouter(
      (_request, _signal, hooks) =>
        new Promise((resolve) => {
          hooks.onDelta?.('Parcial')
          release = () => resolve({ text: 'Parcial completo' })
        })
    )
    const { service } = makeService(router)
    const sent = await service.send(GROUP, 'Pergunta')
    const state = await service.get(GROUP)
    expect(state).toMatchObject({
      ok: true,
      value: { pending: { text: 'Parcial' }, scope: { periodDays: 30, maxMeetings: 5 } }
    })
    expect(state.ok && state.value.pendingScope.map((ref) => ref.id)).toEqual(['a'])
    expect(sent.ok && sent.value.scope.map((ref) => ref.id)).toEqual(['a'])
    release()
    await settled(service)
    const after = await service.get(GROUP)
    expect(after.ok && after.value.pending).toBeNull()
    expect(after.ok && after.value.messages).toHaveLength(2)
  })

  it('setScope guarda e esquece marcações de Reuniões que não são do grupo', async () => {
    await addMeeting('a', 1)
    const { router } = fakeRouter(streaming('x'))
    const { service } = makeService(router)
    const saved = await service.setScope(GROUP, {
      periodDays: 90,
      maxMeetings: 8,
      include: ['a', 'fantasma'],
      exclude: ['zzz']
    })
    expect(saved).toEqual({
      ok: true,
      value: { periodDays: 90, maxMeetings: 8, include: ['a'], exclude: [] }
    })
    const state = await service.get(GROUP)
    expect(state.ok && state.value.scope.periodDays).toBe(90)
    expect(await service.setScope('outro', {})).toMatchObject({ ok: false })
  })

  it('o escopo sobrevive a limpar a Conversa; limpar zera as mensagens e os rótulos', async () => {
    await addMeeting('a', 1)
    const { router } = fakeRouter(streaming('ok'))
    const { service, store } = makeService(router)
    await service.setScope(GROUP, { periodDays: 7, maxMeetings: 3, include: [], exclude: [] })
    await service.send(GROUP, 'Pergunta')
    await settled(service)
    expect((await service.clear(GROUP)).ok).toBe(true)
    const read = await store.read(GROUP)
    expect(read.ok && read.chat.messages).toEqual([])
    expect(read.ok && read.chat.labels).toEqual({})
    expect(read.ok && read.chat.scope.periodDays).toBe(7)
  })

  it('limpar durante uma resposta a interrompe antes', async () => {
    await addMeeting('a', 1)
    const { router } = fakeRouter(
      (_request, signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new AiError('cancelled', 'Cancelado.')))
        })
    )
    const { service, store } = makeService(router)
    await service.send(GROUP, 'Pergunta')
    expect((await service.clear(GROUP)).ok).toBe(true)
    expect(service.isActive(GROUP)).toBe(false)
    const read = await store.read(GROUP)
    expect(read.ok && read.chat.messages).toEqual([])
  })

  it('discard (grupo apagado) interrompe e apaga o arquivo da Conversa', async () => {
    await addMeeting('a', 1)
    const { router } = fakeRouter(streaming('ok'))
    const { service } = makeService(router)
    await service.send(GROUP, 'Pergunta')
    await settled(service)
    const file = join(root, '.clearmeet', 'chats', `${GROUP}.json`)
    expect(await readFile(file, 'utf8')).toContain('Pergunta')
    expect((await service.discard(GROUP)).ok).toBe(true)
    await expect(readFile(file, 'utf8')).rejects.toThrow()
  })
})
