import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MEETING_SCHEMA_VERSION, serializeMeeting, type MeetingFile } from '@shared/meeting'
import {
  assignSpeakers,
  TRANSCRIPT_FILE,
  TRANSCRIPT_PARTIAL_FILE,
  type TranscriptChangedEvent
} from '@shared/transcript'
import { readMeeting } from '../../meetings/repository'
import { readTranscript } from '../../meetings/transcript-store'
import { AiError } from '../errors'
import type { GeminiFile, GenerateRequest, GenerateResult } from '../gemini'
import { TranscriptionService, type AiClient, type TranscriptionDeps } from './service'

const MIN = 60_000
const TOOLS = { ffmpegPath: 'ffmpeg', ffprobePath: 'ffprobe' }

function meeting(overrides: Partial<MeetingFile> = {}): MeetingFile {
  return {
    schemaVersion: MEETING_SCHEMA_VERSION,
    id: 'meeting-1234567890',
    name: 'Reunião',
    createdAt: '2026-10-10T17:30:00.000Z',
    endedAt: '2026-10-10T18:00:00.000Z',
    durationMs: 5 * MIN,
    status: 'ready',
    source: { kind: 'none', name: null },
    quality: '1080p',
    video: null,
    audio: { file: 'audio.opus' },
    inputs: { mic: true, systemAudio: true },
    notes: [],
    issues: [],
    ...overrides
  }
}

/** Resposta no formato do Gemini: lista de Falantes com id e Falas que citam o id. */
const reply = (
  ...utterances: { speaker: string; start: string; text: string }[]
): GenerateResult => {
  const speakers = assignSpeakers(utterances.map((u) => u.speaker))
  const idOf = (label: string): string =>
    speakers.find((s) => (s.name ?? `Falante ${s.id.slice(1)}`) === label)?.id as string
  return {
    text: JSON.stringify({
      speakers,
      utterances: utterances.map((u) => ({
        speakerId: idOf(u.speaker),
        start: u.start,
        text: u.text
      }))
    }),
    truncated: false
  }
}

interface FakeOptions {
  generate?: (
    request: GenerateRequest,
    chunk: number,
    signal?: AbortSignal
  ) => Promise<GenerateResult>
  upload?: (chunk: number) => Promise<void>
}

/** Cliente falso: o número do bloco viaja no nome do arquivo (`...-N`) e no `uri`. */
function fakeClient(options: FakeOptions = {}) {
  const generated: { request: GenerateRequest; chunk: number }[] = []
  const uploads: string[] = []
  const deleted: string[] = []
  let running = 0
  let maxRunning = 0
  const client: AiClient = {
    uploadFile: async (input) => {
      const chunk = Number(input.displayName.split('-').at(-1)) - 1
      await options.upload?.(chunk)
      uploads.push(input.displayName)
      return {
        name: `files/${chunk}`,
        uri: `uri-${chunk}`,
        mimeType: input.mimeType,
        state: 'ACTIVE'
      }
    },
    waitUntilActive: (file: GeminiFile) => Promise.resolve(file),
    deleteFile: (name) => {
      deleted.push(name)
      return Promise.resolve()
    },
    generate: async (request, signal) => {
      const part = request.parts.find((p) => 'fileData' in p)
      const chunk = Number(
        (part as { fileData: { fileUri: string } }).fileData.fileUri.split('-')[1]
      )
      generated.push({ request, chunk })
      running++
      maxRunning = Math.max(maxRunning, running)
      try {
        if (options.generate) return await options.generate(request, chunk, signal)
        return reply({ speaker: 'Ana', start: '00:40', text: `fala do bloco ${chunk}` })
      } finally {
        running--
      }
    }
  }
  return { client, generated, uploads, deleted, maxRunning: () => maxRunning }
}

let root: string
let folder: string
let tempRoot: string
let events: TranscriptChangedEvent[]

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'clearmeet-transcricao-'))
  folder = join(root, 'reuniao')
  tempRoot = join(root, '.tmp')
  await mkdir(folder)
  await mkdir(tempRoot)
  await writeFile(join(folder, 'audio.opus'), Buffer.from('audio-falso'))
  events = []
})
afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

async function writeMeetingFile(file: MeetingFile): Promise<void> {
  await writeFile(join(folder, 'meeting.json'), serializeMeeting(file))
}

function makeService(
  client: AiClient,
  overrides: Partial<TranscriptionDeps> & { durationMs?: number } = {}
): TranscriptionService {
  const { durationMs = 5 * MIN, ...rest } = overrides
  return new TranscriptionService({
    meetingsDir: () => root,
    getTools: () => Promise.resolve(TOOLS),
    geminiKey: () => 'chave-falsa-0000000000',
    model: () => 'gemini-3.5-flash-lite',
    createClient: () => client,
    tempRoot,
    emit: (event) => events.push(event),
    now: () => Date.parse('2026-10-12T12:00:00.000Z'),
    log: () => undefined,
    probeDurationMs: () => Promise.resolve(durationMs),
    extract: async (_tools, _input, output) => {
      await writeFile(output, Buffer.from('bloco-falso'))
    },
    ...rest
  })
}

async function settled(service: TranscriptionService): Promise<void> {
  for (let i = 0; i < 400 && service.isActive(folder); i++) {
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  expect(service.isActive(folder)).toBe(false)
}

async function saved(): Promise<MeetingFile> {
  const read = await readMeeting(folder)
  if (!read.ok) throw new Error(read.error)
  return read.value
}

async function exists(name: string): Promise<boolean> {
  return readdir(folder).then((names) => names.includes(name))
}

describe('TranscriptionService: Reunião curta', () => {
  it('transcreve um bloco, grava transcript.json e marca a Reunião como pronta', async () => {
    await writeMeetingFile(meeting())
    const fake = fakeClient({
      generate: () =>
        Promise.resolve(
          reply(
            { speaker: 'Ana', start: '00:05', text: 'Bom dia, pessoal.' },
            { speaker: 'Falante 2', start: '00:12', text: 'Bom dia!' }
          )
        )
    })
    const service = makeService(fake.client)

    expect(await service.start(folder, true)).toEqual({ ok: true, value: null })
    expect(service.isActive(folder)).toBe(true)
    await settled(service)

    const transcript = await readTranscript(folder)
    expect(transcript).toMatchObject({
      ok: true,
      value: {
        schemaVersion: 2,
        model: 'gemini-3.5-flash-lite',
        durationMs: 5 * MIN,
        speakers: [
          { id: 's2', name: 'Ana' },
          { id: 's1', name: null }
        ],
        utterances: [
          { id: 'u1', speakerId: 's2', startMs: 5000, text: 'Bom dia, pessoal.' },
          { id: 'u2', speakerId: 's1', startMs: 12_000, text: 'Bom dia!' }
        ]
      }
    })
    expect((await saved()).transcript).toEqual({
      status: 'ready',
      model: 'gemini-3.5-flash-lite',
      updatedAt: '2026-10-12T12:00:00.000Z',
      summaryRequested: true
    })
    // Um bloco só: o arquivo original vai direto, sem recorte; o upload é apagado no fim.
    expect(fake.uploads).toHaveLength(1)
    expect(fake.deleted).toEqual(['files/0'])
    expect(await exists(TRANSCRIPT_PARTIAL_FILE)).toBe(false)
    expect(await readdir(tempRoot)).toEqual([])

    expect(events.map((e) => e.view.status)).toContain('running')
    expect(events.at(-1)?.view).toMatchObject({ status: 'ready', summaryRequested: true })
    expect(events.every((e) => e.meetingId === 'meeting-1234567890')).toBe(true)
  })

  it('o prompt pede JSON estruturado e o modelo escolhido é o usado', async () => {
    await writeMeetingFile(meeting())
    const fake = fakeClient()
    const service = makeService(fake.client, { model: () => 'gemini-3.6-flash' })
    await service.start(folder, false)
    await settled(service)

    const { request } = fake.generated[0]!
    expect(request.model).toBe('gemini-3.6-flash')
    expect(request.jsonSchema).toBeDefined()
    const text = request.parts.find((p) => 'text' in p) as { text: string }
    expect(text.text).toContain('Do not translate')
    expect(text.text).toContain('never a single utterance')
    expect(text.text).not.toContain('part 1 of')
  })

  it('resposta malformada é pedida de novo; três falhas viram erro', async () => {
    await writeMeetingFile(meeting())
    let calls = 0
    const flaky = fakeClient({
      generate: () => {
        calls++
        return Promise.resolve(
          calls < 3
            ? { text: 'isto não é JSON', truncated: false }
            : reply({ speaker: 'Ana', start: '00:01', text: 'agora sim' })
        )
      }
    })
    const service = makeService(flaky.client)
    await service.start(folder, false)
    await settled(service)
    expect((await saved()).transcript?.status).toBe('ready')
    expect(calls).toBe(3)

    // Mesma Reunião de novo, agora com resposta sempre malformada.
    const broken = fakeClient({
      generate: () => Promise.resolve({ text: '{"nada": true}', truncated: false })
    })
    const again = makeService(broken.client)
    await again.start(folder, false)
    await settled(again)
    expect(broken.generated).toHaveLength(3)
    expect((await saved()).transcript).toMatchObject({
      status: 'error',
      error: expect.stringContaining('não deu para interpretar') as string
    })
    expect(broken.deleted).toEqual(['files/0'])
  })
})

describe('TranscriptionService: Reunião longa', () => {
  const LONG = 56 * MIN

  it('o primeiro bloco vai sozinho, os demais em paralelo com os Falantes já conhecidos, e os Instantes são ajustados', async () => {
    await writeMeetingFile(meeting({ durationMs: LONG }))
    const order: string[] = []
    const fake = fakeClient({
      generate: async (_request, chunk) => {
        order.push(`inicio-${chunk}`)
        await new Promise((resolve) => setTimeout(resolve, 15))
        order.push(`fim-${chunk}`)
        return reply({ speaker: 'Ana', start: '00:40', text: `fala do bloco ${chunk}` })
      }
    })
    const service = makeService(fake.client, { durationMs: LONG })
    await service.start(folder, false)
    await settled(service)

    // O bloco 0 termina antes de qualquer outro começar.
    expect(order.indexOf('fim-0')).toBeLessThan(order.indexOf('inicio-1'))
    expect(order.indexOf('fim-0')).toBeLessThan(order.indexOf('inicio-2'))
    expect(fake.maxRunning()).toBe(2)

    const promptOf = (chunk: number): string => {
      const call = fake.generated.find((g) => g.chunk === chunk)!
      return (call.request.parts.find((p) => 'text' in p) as { text: string }).text
    }
    expect(promptOf(0)).not.toContain('Speakers heard earlier')
    expect(promptOf(1)).toContain('part 2 of 3')
    expect(promptOf(1)).toContain('"Ana"')
    expect(promptOf(2)).toContain('"Ana"')

    const transcript = await readTranscript(folder)
    expect(transcript.ok && transcript.value?.utterances.map((u) => [u.startMs, u.text])).toEqual([
      [40_000, 'fala do bloco 0'],
      // Blocos de 18:40; do segundo em diante começam 60 s antes: 17:40 e 36:20.
      [17 * MIN + 40_000 + 40_000, 'fala do bloco 1'],
      [36 * MIN + 20_000 + 40_000, 'fala do bloco 2']
    ])
    expect(fake.deleted.sort()).toEqual(['files/0', 'files/1', 'files/2'])
  })

  it('um bloco que falha guarda os outros; tentar de novo refaz só o que faltou', async () => {
    await writeMeetingFile(meeting({ durationMs: LONG }))
    let failChunk2 = true
    const fake = fakeClient({
      generate: (_request, chunk) => {
        if (chunk === 2 && failChunk2) {
          return Promise.reject(new AiError('unavailable', 'O serviço está sobrecarregado.'))
        }
        return Promise.resolve(
          reply({ speaker: 'Ana', start: '00:40', text: `fala do bloco ${chunk}` })
        )
      }
    })
    const service = makeService(fake.client, { durationMs: LONG })
    await service.start(folder, false)
    await settled(service)

    const failed = (await saved()).transcript
    expect(failed?.status).toBe('error')
    expect(failed?.error).toContain('Um bloco da Reunião falhou')
    expect(failed?.error).toContain('O que já foi transcrito foi guardado')
    expect(await exists(TRANSCRIPT_FILE)).toBe(false)
    expect(await exists(TRANSCRIPT_PARTIAL_FILE)).toBe(true)
    expect(events.at(-1)?.view.status).toBe('error')

    failChunk2 = false
    fake.generated.length = 0
    await service.start(folder, false)
    await settled(service)

    expect(fake.generated.map((g) => g.chunk)).toEqual([2])
    expect((await saved()).transcript?.status).toBe('ready')
    const transcript = await readTranscript(folder)
    expect(transcript.ok && transcript.value?.utterances).toHaveLength(3)
    expect(await exists(TRANSCRIPT_PARTIAL_FILE)).toBe(false)
  })

  it('trocar de modelo descarta os blocos guardados', async () => {
    await writeMeetingFile(meeting({ durationMs: LONG }))
    const first = fakeClient({
      generate: (_request, chunk) =>
        chunk === 2
          ? Promise.reject(new AiError('unavailable', 'x'))
          : Promise.resolve(reply({ speaker: 'Ana', start: '00:40', text: 'ok' }))
    })
    const service = makeService(first.client, { durationMs: LONG })
    await service.start(folder, false)
    await settled(service)

    const second = fakeClient()
    const other = makeService(second.client, { durationMs: LONG, model: () => 'gemini-3.6-flash' })
    await other.start(folder, false)
    await settled(other)
    expect(second.generated.map((g) => g.chunk).sort()).toEqual([0, 1, 2])
  })

  it('chave recusada interrompe a Transcrição sem insistir nos demais blocos', async () => {
    await writeMeetingFile(meeting({ durationMs: LONG }))
    const fake = fakeClient({
      generate: () => Promise.reject(new AiError('invalid-key', 'A chave foi recusada.'))
    })
    const service = makeService(fake.client, { durationMs: LONG })
    await service.start(folder, false)
    await settled(service)

    expect(fake.generated).toHaveLength(1)
    expect((await saved()).transcript).toMatchObject({
      status: 'error',
      error: 'A chave foi recusada.'
    })
  })
})

describe('TranscriptionService: modelo e Falantes', () => {
  it('o modelo pedido para esta tentativa vale só nela e só se estiver na lista', async () => {
    await writeMeetingFile(meeting())
    const fake = fakeClient()
    const service = makeService(fake.client, { model: () => 'gemini-3.8-flash' })

    await service.start(folder, false, 'gemini-3.6-flash')
    await settled(service)
    expect(fake.generated[0]?.request.model).toBe('gemini-3.6-flash')
    expect((await saved()).transcript?.model).toBe('gemini-3.6-flash')

    await service.start(folder, false, 'modelo-inventado')
    await settled(service)
    expect(fake.generated[1]?.request.model).toBe('gemini-3.8-flash')
  })

  it('a resposta traz Falantes por id: um horário no campo de nome não vira Falante', async () => {
    await writeMeetingFile(meeting())
    const fake = fakeClient({
      generate: () =>
        Promise.resolve({
          text: JSON.stringify({
            speakers: [
              { id: 's1', name: '11:20' },
              { id: 's2', name: 'Bia' }
            ],
            utterances: [
              { speakerId: 's1', start: '00:01', text: 'primeira' },
              { speakerId: 's2', start: '00:05', text: 'segunda' },
              { speakerId: 's1', start: '00:09', text: 'terceira' }
            ]
          }),
          truncated: false
        })
    })
    const service = makeService(fake.client)
    await service.start(folder, false)
    await settled(service)

    const result = await readTranscript(folder)
    expect(result.ok && result.value?.speakers).toEqual([
      { id: 's1', name: null },
      { id: 's2', name: 'Bia' }
    ])
  })

  it('nos blocos seguintes o id de um Falante conhecido volta com o nome que já tinha', async () => {
    await writeMeetingFile(meeting({ durationMs: 56 * MIN }))
    const fake = fakeClient({
      generate: (_request, chunk) =>
        Promise.resolve({
          text: JSON.stringify({
            speakers: [{ id: 's1', name: chunk === 0 ? 'Ana' : null }],
            utterances: [{ speakerId: 's1', start: '00:40', text: `fala ${chunk}` }]
          }),
          truncated: false
        })
    })
    const service = makeService(fake.client, { durationMs: 56 * MIN })
    await service.start(folder, false)
    await settled(service)

    const result = await readTranscript(folder)
    expect(result.ok && result.value?.speakers).toEqual([{ id: 's1', name: 'Ana' }])
    expect(result.ok && result.value?.utterances).toHaveLength(3)
  })
})

describe('TranscriptionService: cancelamento', () => {
  it('cancelar interrompe a chamada, apaga os uploads e volta ao estado sem Transcrição', async () => {
    await writeMeetingFile(meeting())
    let started!: () => void
    const reached = new Promise<void>((resolve) => (started = resolve))
    const fake = fakeClient({
      generate: (_request, _chunk, signal) =>
        new Promise((_resolve, reject) => {
          started()
          signal?.addEventListener('abort', () => reject(new AiError('cancelled', 'Cancelado.')), {
            once: true
          })
        })
    })
    const service = makeService(fake.client)
    await service.start(folder, false)
    await reached
    service.cancel(folder)
    await settled(service)

    expect((await saved()).transcript).toBeUndefined()
    expect(fake.deleted).toEqual(['files/0'])
    expect(await exists(TRANSCRIPT_FILE)).toBe(false)
    expect(await exists(TRANSCRIPT_PARTIAL_FILE)).toBe(false)
    expect(await readdir(tempRoot)).toEqual([])
    expect(events.at(-1)?.view.status).toBe('none')
  })

  it('cancelar um refazer mantém a Transcrição anterior', async () => {
    const previous = {
      status: 'ready' as const,
      model: 'gemini-3.5-flash-lite',
      updatedAt: '2026-10-11T12:00:00.000Z'
    }
    await writeMeetingFile(meeting({ transcript: previous }))
    let started!: () => void
    const reached = new Promise<void>((resolve) => (started = resolve))
    const fake = fakeClient({
      generate: (_request, _chunk, signal) =>
        new Promise((_resolve, reject) => {
          started()
          signal?.addEventListener('abort', () => reject(new AiError('cancelled', 'Cancelado.')), {
            once: true
          })
        })
    })
    const service = makeService(fake.client)
    await service.start(folder, false)
    await reached
    service.cancel(folder)
    await settled(service)
    expect((await saved()).transcript).toEqual(previous)
  })
})

describe('TranscriptionService: pedidos recusados', () => {
  it('sem chave do Gemini, orienta a configurar', async () => {
    await writeMeetingFile(meeting())
    const service = makeService(fakeClient().client, { geminiKey: () => null })
    expect(await service.start(folder, false)).toMatchObject({
      ok: false,
      error: { code: 'no-api-key' }
    })
    expect((await saved()).transcript).toBeUndefined()
  })

  it('só Reunião pronta, com Áudio da reunião e FFmpeg', async () => {
    const fake = fakeClient()
    await writeMeetingFile(meeting({ status: 'processing' }))
    expect(await makeService(fake.client).start(folder, false)).toMatchObject({
      ok: false,
      error: { code: 'busy' }
    })

    await writeMeetingFile(meeting({ audio: null }))
    expect(await makeService(fake.client).start(folder, false)).toMatchObject({
      ok: false,
      error: { code: 'invalid-request' }
    })

    await writeMeetingFile(meeting())
    expect(
      await makeService(fake.client, { getTools: () => Promise.resolve(null) }).start(folder, false)
    ).toMatchObject({ ok: false, error: { code: 'ffmpeg-missing' } })

    await rm(join(folder, 'audio.opus'))
    expect(await makeService(fake.client).start(folder, false)).toMatchObject({ ok: false })
  })

  it('pasta fora da pasta das Reuniões é recusada', async () => {
    const service = makeService(fakeClient().client)
    expect(await service.start(join(root, '..'), false)).toMatchObject({
      ok: false,
      error: { code: 'invalid-request' }
    })
  })

  it('uma Transcrição por vez, e a pasta em uso fica marcada como ativa', async () => {
    await writeMeetingFile(meeting())
    let release!: () => void
    let started!: () => void
    const gate = new Promise<void>((resolve) => (release = resolve))
    const reached = new Promise<void>((resolve) => (started = resolve))
    const fake = fakeClient({
      generate: async () => {
        started()
        await gate
        return reply()
      }
    })
    const service = makeService(fake.client)

    await service.start(folder, false)
    await reached
    expect(service.isActive(folder)).toBe(true)
    expect(service.progressFor(folder)).toEqual({ done: 0, total: 1 })
    expect(await service.start(folder, false)).toMatchObject({ ok: false, error: { code: 'busy' } })

    release()
    await settled(service)
    expect(service.progressFor(folder)).toBeNull()
  })
})

describe('TranscriptionService.recoverInterrupted', () => {
  it('uma Transcrição "em andamento" de uma sessão anterior vira erro retomável', async () => {
    await writeMeetingFile(
      meeting({
        transcript: {
          status: 'running',
          model: 'gemini-3.5-flash-lite',
          updatedAt: '2026-10-12T10:00:00.000Z'
        }
      })
    )
    await makeService(fakeClient().client).recoverInterrupted()
    const transcript = (await saved()).transcript
    expect(transcript?.status).toBe('error')
    expect(transcript?.error).toContain('interrompida')
  })

  it('não mexe em Transcrições prontas nem em Reuniões sem Transcrição', async () => {
    const ready = {
      status: 'ready' as const,
      model: 'm',
      updatedAt: '2026-10-12T10:00:00.000Z'
    }
    await writeMeetingFile(meeting({ transcript: ready }))
    await makeService(fakeClient().client).recoverInterrupted()
    expect((await saved()).transcript).toEqual(ready)
    expect(await readFile(join(folder, 'meeting.json'), 'utf8')).toContain('"ready"')
  })
})
