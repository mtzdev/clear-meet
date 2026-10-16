import { readdir } from 'node:fs/promises'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SUMMARY_FILE, type SummaryChangedEvent } from '@shared/summary'
import { readMeeting } from '../../meetings/repository'
import { readSummary } from '../../meetings/summary-store'
import { AiError } from '../errors'
import { meetingFile, tempMeetings, transcriptFile, type TempMeetings } from '../testing'
import type { TextRequest, TextResult } from '../text/types'
import { SummaryService, type SummaryTextRouter } from './service'

let dir: TempMeetings
let events: SummaryChangedEvent[]

beforeEach(async () => {
  dir = await tempMeetings()
  events = []
})
afterEach(async () => {
  await dir.cleanup()
})

const GOOD = JSON.stringify({
  overview: 'A equipe adiou o lançamento.',
  keyPoints: [{ text: 'Lançamento adiado', citations: ['00:05'] }],
  decisions: [{ text: 'Novo prazo em novembro', citations: ['01:05', '99:00'] }],
  actions: [{ owner: 'Ana', task: 'Avisar o cliente', due: 'amanhã', citations: ['01:05'] }]
})

interface FakeRouter extends SummaryTextRouter {
  requests: TextRequest[]
}

function fakeRouter(
  respond: (call: number, signal: AbortSignal) => Promise<Partial<TextResult> & { text: string }>,
  hasProvider = true
): FakeRouter {
  const requests: TextRequest[] = []
  return {
    requests,
    hasProvider: () => hasProvider,
    run: async (request, signal) => {
      requests.push(request)
      const result = await respond(requests.length, signal)
      return { truncated: false, provider: 'groq', model: 'openai/gpt-oss-120b', ...result }
    }
  }
}

function makeService(router: SummaryTextRouter, logs: string[] = []): SummaryService {
  return new SummaryService({
    meetingsDir: () => dir.root,
    router,
    emit: (event) => events.push(event),
    now: () => Date.parse('2026-10-13T13:00:00.000Z'),
    log: (message) => logs.push(message)
  })
}

async function settled(service: SummaryService): Promise<void> {
  for (let i = 0; i < 400 && service.isActive(dir.folder); i++) {
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  expect(service.isActive(dir.folder)).toBe(false)
}

async function saved() {
  const read = await readMeeting(dir.folder)
  if (!read.ok) throw new Error(read.error)
  return read.value
}

describe('SummaryService.start', () => {
  it('gera o Resumo, grava summary.json e o estado no meeting.json', async () => {
    const router = fakeRouter(() => Promise.resolve({ text: GOOD }))
    const service = makeService(router)

    expect(await service.start(dir.folder)).toEqual({ ok: true, value: null })
    expect(service.isActive(dir.folder)).toBe(true)
    expect((await saved()).summary?.status).toBe('running')
    await settled(service)

    const summary = await readSummary(dir.folder)
    expect(summary).toMatchObject({
      ok: true,
      value: {
        schemaVersion: 1,
        provider: 'groq',
        model: 'openai/gpt-oss-120b',
        createdAt: '2026-10-13T13:00:00.000Z',
        overview: 'A equipe adiou o lançamento.',
        keyPoints: [{ text: 'Lançamento adiado', at: [5000] }],
        // O Instante 99:00 passa da duração da Reunião (10 min) e sai.
        decisions: [{ text: 'Novo prazo em novembro', at: [65_000] }],
        actions: [{ owner: 'Ana', task: 'Avisar o cliente', due: 'amanhã', at: [65_000] }]
      }
    })
    expect((await saved()).summary).toEqual({
      status: 'ready',
      provider: 'groq',
      model: 'openai/gpt-oss-120b',
      updatedAt: '2026-10-13T13:00:00.000Z'
    })
    expect(events.map((event) => event.view.status)).toEqual(['running', 'ready'])
    expect(await readdir(dir.folder)).toContain(SUMMARY_FILE)
  })

  it('manda a Transcrição formatada, com o schema da saída estruturada', async () => {
    const router = fakeRouter(() => Promise.resolve({ text: GOOD }))
    const service = makeService(router)
    await service.start(dir.folder)
    await settled(service)

    const request = router.requests[0] as TextRequest
    expect(request.json?.name).toBe('meeting_summary')
    expect(request.messages).toHaveLength(1)
    expect(request.messages[0]?.content).toContain('[00:05] Ana: Vamos adiar o lançamento.')
    expect(request.messages[0]?.content).toContain('[01:05] Falante 2: Concordo')
  })

  it('registra o provedor que de fato respondeu (fallback para o Gemini)', async () => {
    const service = makeService(
      fakeRouter(() => Promise.resolve({ text: GOOD, provider: 'gemini', model: 'gemini-x' }))
    )
    await service.start(dir.folder)
    await settled(service)
    expect((await saved()).summary).toMatchObject({ provider: 'gemini', model: 'gemini-x' })
  })

  it('JSON malformado: tenta mais uma vez e aproveita a segunda resposta', async () => {
    const logs: string[] = []
    const router = fakeRouter((call) =>
      Promise.resolve({ text: call === 1 ? '{"overview": "cort' : GOOD })
    )
    const service = makeService(router, logs)
    await service.start(dir.folder)
    await settled(service)

    expect(router.requests).toHaveLength(2)
    expect((await saved()).summary?.status).toBe('ready')
    expect(logs.join(' ')).toContain('resposta inválida')
  })

  it('JSON malformado duas vezes: erro, sem summary.json, e o log não traz conteúdo', async () => {
    const logs: string[] = []
    const service = makeService(
      fakeRouter(() => Promise.resolve({ text: 'Vamos adiar o lançamento (conteúdo)' })),
      logs
    )
    await service.start(dir.folder)
    await settled(service)

    const meeting = await saved()
    expect(meeting.summary).toMatchObject({
      status: 'error',
      error: 'A IA devolveu uma resposta que não deu para interpretar.'
    })
    expect(await readSummary(dir.folder)).toEqual({ ok: true, value: null })
    expect(logs.join(' ')).not.toContain('Vamos adiar')
  })

  it('erro da IA (ex.: cota) vira estado de erro com a mensagem para o usuário', async () => {
    const service = makeService(
      fakeRouter(() => Promise.reject(new AiError('quota', 'Limite de uso atingido.')))
    )
    await service.start(dir.folder)
    await settled(service)
    expect((await saved()).summary).toMatchObject({
      status: 'error',
      error: 'Limite de uso atingido.'
    })
    expect(events.at(-1)?.view).toMatchObject({ status: 'error', error: 'Limite de uso atingido.' })
  })

  it('cancelar volta ao estado anterior (Resumo pronto é preservado)', async () => {
    const previous = {
      status: 'ready' as const,
      provider: 'groq' as const,
      model: 'm',
      updatedAt: '2026-10-13T12:30:00.000Z'
    }
    await dir.cleanup()
    dir = await tempMeetings(meetingFile({ summary: previous }))
    const router = fakeRouter(
      (_call, signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new AiError('cancelled', 'Cancelado.')))
        })
    )
    const service = makeService(router)
    await service.start(dir.folder)
    service.cancel(dir.folder)
    await settled(service)
    expect((await saved()).summary).toEqual(previous)
  })

  it('cancelar sem Resumo anterior remove o estado', async () => {
    const router = fakeRouter(
      (_call, signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new AiError('cancelled', 'Cancelado.')))
        })
    )
    const service = makeService(router)
    await service.start(dir.folder)
    service.cancel(dir.folder)
    await settled(service)
    expect((await saved()).summary).toBeUndefined()
  })

  it('recusa sem chave, sem Transcrição pronta, vazia ou com outro Resumo em andamento', async () => {
    const never = fakeRouter(
      (_call, signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new AiError('cancelled', 'Cancelado.')))
        })
    )
    expect(
      await makeService(fakeRouter(() => Promise.resolve({ text: GOOD }), false)).start(dir.folder)
    ).toMatchObject({ ok: false, error: { code: 'no-api-key' } })

    const busy = makeService(never)
    await busy.start(dir.folder)
    expect(await busy.start(dir.folder)).toMatchObject({ ok: false, error: { code: 'busy' } })
    busy.cancel(dir.folder)
    await settled(busy)

    expect(await makeService(never).start(`${dir.root}-fora`)).toMatchObject({
      ok: false,
      error: { code: 'invalid-request' }
    })

    await dir.cleanup()
    dir = await tempMeetings(meetingFile({ transcript: undefined }))
    expect(await makeService(never).start(dir.folder)).toMatchObject({
      ok: false,
      error: { code: 'invalid-request' }
    })

    await dir.cleanup()
    dir = await tempMeetings(meetingFile(), transcriptFile({ utterances: [] }))
    expect(await makeService(never).start(dir.folder)).toMatchObject({
      ok: false,
      error: { message: 'A Transcrição está vazia: não há o que resumir.' }
    })
  })
})

describe('SummaryService.startAfterTranscript ("Transcrever + resumir")', () => {
  it('gera o Resumo quando a Transcrição está pronta', async () => {
    const service = makeService(fakeRouter(() => Promise.resolve({ text: GOOD })))
    await service.startAfterTranscript(dir.folder)
    await settled(service)
    expect((await saved()).summary?.status).toBe('ready')
  })

  it('se não der para começar, o motivo fica no estado do Resumo e a UI é avisada', async () => {
    const service = makeService(fakeRouter(() => Promise.resolve({ text: GOOD }), false))
    await service.startAfterTranscript(dir.folder)

    expect((await saved()).summary).toMatchObject({
      status: 'error',
      error: 'Configure a chave do Gemini ou da Groq nas Configurações.'
    })
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      meetingId: 'meeting-1234567890',
      view: { status: 'error' }
    })
  })
})

describe('SummaryService.recoverInterrupted', () => {
  it('um Resumo "em andamento" de uma sessão anterior vira erro retomável', async () => {
    await dir.cleanup()
    dir = await tempMeetings(
      meetingFile({ summary: { status: 'running', updatedAt: '2026-10-13T12:30:00.000Z' } })
    )
    await makeService(fakeRouter(() => Promise.resolve({ text: GOOD }))).recoverInterrupted()
    expect((await saved()).summary).toMatchObject({
      status: 'error',
      error: 'O Resumo foi interrompido porque o app foi fechado. Tente de novo.'
    })
  })
})
