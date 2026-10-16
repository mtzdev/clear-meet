import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MAX_QUESTION_LENGTH, type ChatEvent } from '@shared/chat'
import { readChat } from '../../meetings/chat-store'
import { AiError } from '../errors'
import { meetingFile, tempMeetings, type TempMeetings } from '../testing'
import type { TextHooks, TextRequest, TextResult } from '../text/types'
import { ChatService, type ChatTextRouter } from './service'

let dir: TempMeetings
let events: ChatEvent[]

beforeEach(async () => {
  dir = await tempMeetings()
  events = []
})
afterEach(async () => {
  await dir.cleanup()
})

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
function makeService(router: ChatTextRouter, logs: string[] = []): ChatService {
  return new ChatService({
    meetingsDir: () => dir.root,
    router,
    emit: (event) => events.push(event),
    now: () => Date.parse('2026-10-13T13:00:00.000Z'),
    newId: () => `id-${++ids}`,
    log: (message) => logs.push(message)
  })
}

async function settled(service: ChatService): Promise<void> {
  for (let i = 0; i < 400 && service.isActive(dir.folder); i++) {
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  expect(service.isActive(dir.folder)).toBe(false)
}

const stored = async () => {
  const chat = await readChat(dir.folder)
  if (!chat.ok) throw new Error(chat.error.message)
  return chat.value
}

describe('ChatService.send', () => {
  it('grava a pergunta, transmite a resposta aos poucos e a grava com o provedor', async () => {
    const { router, requests } = fakeRouter(streaming('Adiaram ', 'o lançamento [00:05].'))
    const service = makeService(router)

    const sent = await service.send(dir.folder, '  Quais foram as decisões?  ')
    expect(sent.ok).toBe(true)
    if (!sent.ok) return
    expect(sent.value.user).toMatchObject({ role: 'user', text: 'Quais foram as decisões?' })
    await settled(service)

    expect(events.map((event) => event.type)).toEqual(['delta', 'delta', 'done'])
    const done = events.at(-1)
    expect(done).toMatchObject({
      type: 'done',
      messageId: sent.value.assistantId,
      message: {
        role: 'assistant',
        text: 'Adiaram o lançamento [00:05].',
        provider: 'groq',
        model: 'openai/gpt-oss-120b'
      }
    })
    const messages = await stored()
    expect(messages.map((m) => m.role)).toEqual(['user', 'assistant'])

    const request = requests[0] as TextRequest
    expect(request.system).toContain('[00:05] Ana: Vamos adiar o lançamento.')
    expect(request.system).toContain('[01:05] Falante 2: Concordo')
    expect(request.messages).toEqual([{ role: 'user', content: 'Quais foram as decisões?' }])
  })

  it('manda à IA só as últimas mensagens, começando por uma pergunta', async () => {
    const { router, requests } = fakeRouter(streaming('ok'))
    const service = makeService(router)
    for (let i = 1; i <= 10; i++) {
      await service.send(dir.folder, `pergunta ${i}`)
      await settled(service)
    }
    const last = requests.at(-1) as TextRequest
    expect(last.messages.length).toBeLessThanOrEqual(12)
    expect(last.messages[0]?.role).toBe('user')
    expect(last.messages.at(-1)).toEqual({ role: 'user', content: 'pergunta 10' })
    expect(last.messages.some((m) => m.content === 'pergunta 1')).toBe(false)
    expect((await stored()).length).toBe(20)
  })

  it('parar a geração guarda o que já chegou, marcado como interrompido', async () => {
    const { router } = fakeRouter(
      (_request, signal, hooks) =>
        new Promise((_resolve, reject) => {
          hooks.onDelta?.('Resposta até aqui')
          signal.addEventListener('abort', () => reject(new AiError('cancelled', 'Cancelado.')))
        })
    )
    const service = makeService(router)
    await service.send(dir.folder, 'pergunta')
    service.stop(dir.folder)
    await settled(service)

    expect(events.at(-1)).toMatchObject({
      type: 'done',
      message: { role: 'assistant', text: 'Resposta até aqui', stopped: true }
    })
    expect((await stored()).at(-1)).toMatchObject({ stopped: true })
  })

  it('parar antes de chegar texto não grava resposta alguma', async () => {
    const { router } = fakeRouter(
      (_request, signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new AiError('cancelled', 'Cancelado.')))
        })
    )
    const service = makeService(router)
    await service.send(dir.folder, 'pergunta')
    service.stop(dir.folder)
    await settled(service)
    expect(events.at(-1)).toMatchObject({ type: 'done', message: null })
    expect((await stored()).map((m) => m.role)).toEqual(['user'])
  })

  it('erro da IA: evento de erro, pergunta preservada e "tentar de novo" sem repeti-la', async () => {
    const logs: string[] = []
    let fail = true
    const { router, requests } = fakeRouter((_request, _signal, hooks) => {
      if (fail) return Promise.reject(new AiError('too-large', 'Grande demais.'))
      hooks.onDelta?.('Agora foi')
      return Promise.resolve({ text: 'Agora foi' })
    })
    const service = makeService(router, logs)
    await service.send(dir.folder, 'pergunta secreta do conteúdo')
    await settled(service)

    expect(events.at(-1)).toMatchObject({ type: 'error', message: 'Grande demais.' })
    expect((await stored()).map((m) => m.role)).toEqual(['user'])
    expect(logs.join(' ')).not.toContain('secreta')

    fail = false
    const retry = await service.send(dir.folder, null)
    expect(retry).toMatchObject({ ok: true, value: { user: null } })
    await settled(service)
    expect((await stored()).map((m) => m.role)).toEqual(['user', 'assistant'])
    expect(requests.at(-1)?.messages).toEqual([
      { role: 'user', content: 'pergunta secreta do conteúdo' }
    ])
  })

  it('repetir sem pergunta pendente é recusado', async () => {
    const { router } = fakeRouter(streaming('ok'))
    const service = makeService(router)
    expect(await service.send(dir.folder, null)).toMatchObject({
      ok: false,
      error: { code: 'invalid-request' }
    })
  })

  it('uma resposta por vez por Reunião', async () => {
    const { router } = fakeRouter(
      (_request, signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new AiError('cancelled', 'Cancelado.')))
        })
    )
    const service = makeService(router)
    await service.send(dir.folder, 'primeira')
    expect(await service.send(dir.folder, 'segunda')).toMatchObject({
      ok: false,
      error: { code: 'busy' }
    })
    service.stop(dir.folder)
    await settled(service)
  })

  it('get devolve a resposta em geração para a UI retomar ao reabrir a aba', async () => {
    let release: (() => void) | undefined
    const { router } = fakeRouter(
      (_request, _signal, hooks) =>
        new Promise((resolve) => {
          hooks.onDelta?.('meio')
          release = () => resolve({ text: 'meio' })
        })
    )
    const service = makeService(router)
    const sent = await service.send(dir.folder, 'pergunta')
    const state = await service.get(dir.folder)
    expect(state).toMatchObject({
      ok: true,
      value: {
        messages: [{ role: 'user' }],
        pending: { messageId: sent.ok ? sent.value.assistantId : '', text: 'meio' }
      }
    })
    release?.()
    await settled(service)
    expect(await service.get(dir.folder)).toMatchObject({ value: { pending: null } })
  })

  it('recusa pergunta vazia ou longa, sem chave, sem Transcrição pronta e pasta fora das Reuniões', async () => {
    const ok = fakeRouter(streaming('ok')).router
    const service = makeService(ok)
    expect(await service.send(dir.folder, '   ')).toMatchObject({ ok: false })
    expect(await service.send(dir.folder, 'x'.repeat(MAX_QUESTION_LENGTH + 1))).toMatchObject({
      ok: false
    })
    expect(await service.send(`${dir.root}-fora`, 'oi')).toMatchObject({
      ok: false,
      error: { code: 'invalid-request' }
    })
    expect(
      await makeService(fakeRouter(streaming('ok'), false).router).send(dir.folder, 'oi')
    ).toMatchObject({ ok: false, error: { code: 'no-api-key' } })

    await dir.cleanup()
    dir = await tempMeetings(meetingFile({ transcript: undefined }))
    expect(await makeService(ok).send(dir.folder, 'oi')).toMatchObject({
      ok: false,
      error: { code: 'invalid-request' }
    })
  })
})

describe('ChatService.clear', () => {
  it('apaga a Conversa; uma resposta em andamento é interrompida antes', async () => {
    const { router } = fakeRouter(
      (_request, signal, hooks) =>
        new Promise((_resolve, reject) => {
          hooks.onDelta?.('parcial')
          signal.addEventListener('abort', () => reject(new AiError('cancelled', 'Cancelado.')))
        })
    )
    const service = makeService(router)
    await service.send(dir.folder, 'pergunta')
    expect(await service.clear(dir.folder)).toEqual({ ok: true, value: null })
    expect(service.isActive(dir.folder)).toBe(false)
    expect(await stored()).toEqual([])
  })
})
