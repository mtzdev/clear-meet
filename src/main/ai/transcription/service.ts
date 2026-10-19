import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { isTranscriptionModel, transcriptionEngine } from '@shared/ai'
import type { MeetingFile } from '@shared/meeting'
import type { RecordingError, Result } from '@shared/recording'
import {
  assignSpeakers,
  makeTranscriptView,
  TRANSCRIPT_SCHEMA_VERSION,
  type TranscriptChangedEvent,
  type TranscriptFile,
  type TranscriptMeta,
  type Speaker,
  type TranscriptProgress
} from '@shared/transcript'
import { runProcess, probeMedia, type FfmpegTools, type RunProcess } from '../../ffmpeg/media'
import { sameFolder } from '../../meetings/paths'
import { isDirectChild, listMeetingFolders, readMeeting } from '../../meetings/repository'
import {
  readPartial,
  removePartial,
  updateTranscriptMeta,
  writePartial,
  writeTranscript,
  type PartialChunk
} from '../../meetings/transcript-store'
import { AI_MESSAGES, AiError, isAiError, isFatalKind } from '../errors'
import type {
  GeminiFile,
  GenerateRequest,
  GenerateResult,
  TranscribeRequest,
  TranscribeResult
} from '../gemini'
import { ChunkParseError, parseChunkResponse } from './parse'
import { chunkDurationMs, matchesPlan, planChunks, type ChunkPlan } from './plan'
import { buildTranscriptionPrompt, TRANSCRIPT_RESPONSE_SCHEMA } from './prompt'
import { finalizeUtterances, mergeChunks, speakersOf, type ChunkResult } from './reconcile'
import { CHUNK_MIME_TYPE, extractChunk } from './split'
import { groupWords } from './words'

/** O que o pipeline usa do cliente do Gemini (permite testar sem rede). */
export interface AiClient {
  uploadFile(
    input: { data: Uint8Array; mimeType: string; displayName: string },
    signal?: AbortSignal
  ): Promise<GeminiFile>
  waitUntilActive(file: GeminiFile, signal?: AbortSignal): Promise<GeminiFile>
  deleteFile(name: string): Promise<void>
  generate(request: GenerateRequest, signal?: AbortSignal): Promise<GenerateResult>
  transcribe(request: TranscribeRequest, signal?: AbortSignal): Promise<TranscribeResult>
}

export interface TranscriptionDeps {
  meetingsDir(): string
  getTools(): Promise<FfmpegTools | null>
  geminiKey(): string | null
  model(): string
  createClient(apiKey: string): AiClient
  tempRoot: string
  emit(event: TranscriptChangedEvent): void
  /** Chamado quando uma Transcrição termina; `summaryRequested` é o "Transcrever + resumir". */
  onReady?(folder: string, summaryRequested: boolean): void
  now(): number
  log(message: string): void
  /** Blocos transcritos ao mesmo tempo (depois do primeiro). */
  concurrency?: number
  run?: RunProcess
  probeDurationMs?: (tools: FfmpegTools, file: string) => Promise<number | null>
  extract?: (tools: FfmpegTools, input: string, output: string, plan: ChunkPlan) => Promise<void>
}

interface Job {
  folder: string
  meetingId: string
  controller: AbortController
  progress: TranscriptProgress
  meta: TranscriptMeta
  /** Estado a restaurar se o usuário cancelar (uma Transcrição pronta que está sendo refeita). */
  previous: TranscriptMeta | undefined
}

const DEFAULT_CONCURRENCY = 3
const PARSE_ATTEMPTS = 3
const MAX_OUTPUT_TOKENS = 65_536

function fail(code: RecordingError['code'], message: string): { ok: false; error: RecordingError } {
  return { ok: false, error: { code, message } }
}

class UserFacingError extends Error {}

/**
 * Transcrição em segundo plano no main: divide o Áudio da reunião em blocos, envia cada um ao
 * Gemini, junta as Falas e grava `transcript.json`. Uma Transcrição por vez; navegar na UI não
 * a interrompe. Os blocos prontos ficam em `transcript.partial.json`, então "tentar de novo"
 * (também depois de fechar o app) só refaz o que falta.
 */
export class TranscriptionService {
  private job: Job | null = null

  constructor(private readonly deps: TranscriptionDeps) {}

  isActive(folder: string): boolean {
    return this.job !== null && sameFolder(this.job.folder, folder)
  }

  hasActive(): boolean {
    return this.job !== null
  }

  progressFor(folder: string): TranscriptProgress | null {
    return this.job && sameFolder(this.job.folder, folder) ? { ...this.job.progress } : null
  }

  cancel(folder: string): void {
    if (this.job && sameFolder(this.job.folder, folder)) this.job.controller.abort()
  }

  async start(
    folder: string,
    summaryRequested: boolean,
    modelOverride?: string
  ): Promise<Result<null>> {
    const root = this.deps.meetingsDir()
    if (!isDirectChild(root, folder)) {
      return fail('invalid-request', 'A pasta não está dentro da pasta das Reuniões.')
    }
    if (this.job) {
      return fail(
        'busy',
        this.isActive(folder)
          ? 'A Transcrição desta Reunião já está em andamento.'
          : 'Outra Transcrição está em andamento. Aguarde ela terminar.'
      )
    }
    const key = this.deps.geminiKey()
    if (!key) {
      return fail('no-api-key', 'Configure a chave do Gemini nas Configurações para transcrever.')
    }
    const read = await readMeeting(folder)
    if (!read.ok) return fail('not-found', 'A Reunião não foi encontrada.')
    const meeting = read.value
    if (meeting.status !== 'ready') {
      return fail('busy', 'A Reunião ainda não terminou de ser gravada ou processada.')
    }
    if (!meeting.audio || !(await isFile(join(folder, meeting.audio.file)))) {
      return fail('invalid-request', 'Esta Reunião não tem o Áudio da reunião para transcrever.')
    }
    const tools = await this.deps.getTools()
    if (!tools) {
      return fail('ffmpeg-missing', 'O FFmpeg não está instalado; ele prepara o áudio para a IA.')
    }
    if (this.job) return fail('busy', 'Outra Transcrição está em andamento. Aguarde ela terminar.')

    const model =
      modelOverride && isTranscriptionModel(modelOverride) ? modelOverride : this.deps.model()
    const meta: TranscriptMeta = {
      status: 'running',
      model,
      updatedAt: new Date(this.deps.now()).toISOString(),
      ...(summaryRequested ? { summaryRequested: true } : {})
    }
    const job: Job = {
      folder,
      meetingId: meeting.id,
      controller: new AbortController(),
      progress: { done: 0, total: 0 },
      meta,
      previous: meeting.transcript
    }
    this.job = job
    try {
      await updateTranscriptMeta(folder, () => meta)
    } catch {
      this.job = null
      return fail('unknown', 'Não foi possível salvar o estado da Transcrição no disco.')
    }
    this.publish(job)
    void this.run(job, meeting, tools, this.deps.createClient(key))
    return { ok: true, value: null }
  }

  /** Ao abrir o app: uma Transcrição que ficou "em andamento" foi interrompida; vira erro retomável. */
  async recoverInterrupted(): Promise<void> {
    for (const folder of await listMeetingFolders(this.deps.meetingsDir())) {
      if (this.isActive(folder)) continue
      const read = await readMeeting(folder)
      if (!read.ok || read.value.transcript?.status !== 'running') continue
      await updateTranscriptMeta(folder, (previous) =>
        previous?.status === 'running'
          ? {
              ...previous,
              status: 'error',
              error:
                'A Transcrição foi interrompida porque o app foi fechado. Tente de novo: o que já estava pronto é aproveitado.',
              updatedAt: new Date(this.deps.now()).toISOString()
            }
          : previous
      ).catch(() => undefined)
    }
  }

  private publish(job: Job): void {
    const event: TranscriptChangedEvent = {
      meetingId: job.meetingId,
      folder: job.folder,
      view: makeTranscriptView(job.meta, job.progress)
    }
    this.deps.emit(event)
  }

  /** Grava o estado final, libera o serviço e avisa a UI. */
  private async settle(job: Job, meta: TranscriptMeta | undefined): Promise<void> {
    try {
      await updateTranscriptMeta(job.folder, () => meta)
    } catch (error) {
      this.deps.log(`[transcrição] não foi possível gravar o estado final: ${describe(error)}`)
    }
    job.meta = meta ?? { status: 'none', model: job.meta.model, updatedAt: job.meta.updatedAt }
    this.job = null
    this.publish(job)
  }

  private async run(
    job: Job,
    meeting: MeetingFile,
    tools: FfmpegTools,
    client: AiClient
  ): Promise<void> {
    let tempDir: string | null = null
    try {
      tempDir = await mkdtemp(join(this.deps.tempRoot, 'clearmeet-transcricao-'))
      const transcript = await this.execute(job, meeting, tools, client, tempDir)
      await writeTranscript(job.folder, transcript)
      await removePartial(job.folder).catch(() => undefined)
      await this.settle(job, {
        status: 'ready',
        model: transcript.model,
        updatedAt: new Date(this.deps.now()).toISOString(),
        ...(job.meta.summaryRequested ? { summaryRequested: true } : {})
      })
      try {
        this.deps.onReady?.(job.folder, job.meta.summaryRequested === true)
      } catch (error) {
        this.deps.log(`[transcrição] gancho de conclusão falhou: ${describe(error)}`)
      }
    } catch (error) {
      if (job.controller.signal.aborted) {
        await removePartial(job.folder).catch(() => undefined)
        await this.settle(job, job.previous?.status === 'ready' ? job.previous : undefined)
      } else {
        const message = error instanceof UserFacingError || isAiError(error) ? error.message : null
        this.deps.log(`[transcrição] falhou: ${describe(error)}`)
        await this.settle(job, {
          ...job.meta,
          status: 'error',
          error: message ?? AI_MESSAGES.unknown,
          updatedAt: new Date(this.deps.now()).toISOString()
        })
      }
    } finally {
      if (tempDir) await rm(tempDir, { recursive: true, force: true }).catch(() => undefined)
    }
  }

  private async execute(
    job: Job,
    meeting: MeetingFile,
    tools: FfmpegTools,
    client: AiClient,
    tempDir: string
  ): Promise<TranscriptFile> {
    const { folder } = job
    const signal = job.controller.signal
    const model = job.meta.model
    const audioPath = join(folder, (meeting.audio as { file: string }).file)

    const durationMs = (await this.measureDuration(tools, audioPath)) ?? meeting.durationMs ?? 0
    const plans = planChunks(durationMs, transcriptionEngine(model))
    if (plans.length === 0) throw new UserFacingError('O áudio desta Reunião está vazio.')

    const results = new Map<number, ChunkResult>()
    const saved = await readPartial(folder)
    if (saved && saved.model === model) {
      for (const chunk of saved.chunks) {
        const plan = plans[chunk.index]
        if (plan && matchesPlan(chunk, plan)) {
          results.set(chunk.index, { plan, utterances: chunk.utterances })
        }
      }
    }
    job.progress = { done: results.size, total: plans.length }
    this.publish(job)

    let persist: Promise<void> = Promise.resolve()
    const save = (): void => {
      const chunks: PartialChunk[] = [...results.values()]
        .sort((a, b) => a.plan.index - b.plan.index)
        .map((r) => ({
          index: r.plan.index,
          startMs: r.plan.startMs,
          endMs: r.plan.endMs,
          utterances: r.utterances
        }))
      persist = persist
        .then(() => writePartial(folder, { schemaVersion: 1, model, durationMs, chunks }))
        .catch(() => undefined)
    }

    const failures: { plan: ChunkPlan; error: unknown }[] = []
    let stopNew = false
    const transcribe = async (plan: ChunkPlan, known: readonly Speaker[]): Promise<void> => {
      try {
        const utterances = await this.transcribeChunk({
          client,
          tools,
          audioPath,
          tempDir,
          plan,
          plans,
          model,
          known,
          meetingId: job.meetingId,
          signal
        })
        results.set(plan.index, { plan, utterances })
        job.progress = { done: results.size, total: plans.length }
        save()
        this.publish(job)
      } catch (error) {
        if (signal.aborted) throw error
        failures.push({ plan, error })
        if (isAiError(error) && (isFatalKind(error.kind) || error.kind === 'quota')) stopNew = true
        this.deps.log(`[transcrição] bloco ${plan.index + 1} falhou: ${describe(error)}`)
      }
    }

    // O primeiro bloco vai sozinho: os nomes que ele identifica orientam os demais.
    const first = plans[0] as ChunkPlan
    if (!results.has(0)) await transcribe(first, [])
    if (failures.length === 0) {
      const known = assignSpeakers(
        speakersOf([...results.values()].filter((r) => r.plan.index === 0))
      )
      const queue = plans.filter((plan) => !results.has(plan.index))
      const workers = Array.from(
        { length: Math.min(this.deps.concurrency ?? DEFAULT_CONCURRENCY, queue.length) },
        async () => {
          for (let plan = queue.shift(); plan; plan = queue.shift()) {
            if (stopNew || signal.aborted) return
            await transcribe(plan, known)
          }
        }
      )
      // Espera todos terminarem (mesmo após um cancelamento) para os arquivos serem apagados antes de encerrar.
      await Promise.allSettled(workers)
    }
    await persist
    if (signal.aborted) throw new AiError('cancelled', AI_MESSAGES.cancelled)

    if (failures.length > 0) {
      const reason = (failures[0] as { error: unknown }).error
      const text = isAiError(reason) ? reason.message : AI_MESSAGES.unknown
      const prefix =
        plans.length === 1 || (isAiError(reason) && isFatalKind(reason.kind))
          ? ''
          : failures.length === 1
            ? 'Um bloco da Reunião falhou. '
            : `${failures.length} blocos da Reunião falharam. `
      const kept = results.size > 0 ? ' O que já foi transcrito foi guardado.' : ''
      throw new UserFacingError(`${prefix}${text}${kept}`)
    }

    const ordered = plans.map((plan) => results.get(plan.index) as ChunkResult)
    const { speakers, utterances } = finalizeUtterances(
      mergeChunks(ordered, (message) => this.deps.log(message))
    )
    return {
      schemaVersion: TRANSCRIPT_SCHEMA_VERSION,
      model,
      createdAt: new Date(this.deps.now()).toISOString(),
      durationMs,
      speakers,
      utterances
    }
  }

  private async measureDuration(tools: FfmpegTools, file: string): Promise<number | null> {
    try {
      if (this.deps.probeDurationMs) return await this.deps.probeDurationMs(tools, file)
      const info = await probeMedia(tools, file, this.deps.run ?? runProcess)
      return info.durationSec !== null ? Math.round(info.durationSec * 1000) : null
    } catch {
      return null
    }
  }

  private async transcribeChunk(input: {
    client: AiClient
    tools: FfmpegTools
    audioPath: string
    tempDir: string
    plan: ChunkPlan
    plans: readonly ChunkPlan[]
    model: string
    known: readonly Speaker[]
    meetingId: string
    signal: AbortSignal
  }): Promise<ChunkResult['utterances']> {
    const { client, plan, signal } = input
    let path = input.audioPath
    if (input.plans.length > 1) {
      path = join(input.tempDir, `bloco-${plan.index + 1}.opus`)
      const extract =
        this.deps.extract ??
        ((tools, from, to, chunk) =>
          extractChunk(tools, from, to, chunk, this.deps.run ?? runProcess))
      await extract(input.tools, input.audioPath, path, plan)
    }
    const data = await readFile(path)
    if (signal.aborted) throw new AiError('cancelled', AI_MESSAGES.cancelled)

    let uploaded: GeminiFile | null = null
    try {
      uploaded = await client.uploadFile(
        {
          data,
          mimeType: CHUNK_MIME_TYPE,
          displayName: `clearmeet-${input.meetingId.slice(0, 8)}-${plan.index + 1}`
        },
        signal
      )
      const file = await client.waitUntilActive(uploaded, signal)
      if (transcriptionEngine(input.model) === 'transcribe') {
        const { words } = await client.transcribe(
          { model: input.model, fileUri: file.uri, mimeType: file.mimeType },
          signal
        )
        const utterances = groupWords(words, {
          chunkDurationMs: chunkDurationMs(plan),
          speakerBase: plan.index * 100
        })
        const voices = new Set(utterances.map((u) => u.speaker)).size
        this.deps.log(
          `[transcrição] bloco ${plan.index + 1}: ${utterances.length} Falas, ${voices} Falantes`
        )
        return utterances
      }
      const prompt = buildTranscriptionPrompt({
        chunkIndex: plan.index,
        chunkCount: input.plans.length,
        knownSpeakers: input.known
      })
      for (let attempt = 1; ; attempt++) {
        const response = await client.generate(
          {
            model: input.model,
            parts: [{ fileData: { mimeType: file.mimeType, fileUri: file.uri } }, { text: prompt }],
            jsonSchema: TRANSCRIPT_RESPONSE_SCHEMA,
            maxOutputTokens: MAX_OUTPUT_TOKENS
          },
          signal
        )
        try {
          const parsed = parseChunkResponse(response.text, chunkDurationMs(plan), input.known)
          if (parsed.salvaged || response.truncated) {
            this.deps.log(
              `[transcrição] bloco ${plan.index + 1}: resposta cortada, aproveitada em parte`
            )
          }
          const voices = new Set(parsed.utterances.map((u) => u.speaker)).size
          this.deps.log(
            `[transcrição] bloco ${plan.index + 1}: ${parsed.utterances.length} Falas, ${voices} Falantes`
          )
          return parsed.utterances
        } catch (error) {
          if (!(error instanceof ChunkParseError)) throw error
          if (attempt >= PARSE_ATTEMPTS) {
            throw new AiError('bad-response', AI_MESSAGES['bad-response'])
          }
        }
      }
    } finally {
      if (uploaded) await client.deleteFile(uploaded.name)
    }
  }
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile()
  } catch {
    return false
  }
}

/** Texto para o log: só o tipo e a mensagem, nunca cabeçalhos nem chaves. */
function describe(error: unknown): string {
  if (isAiError(error))
    return `${error.kind}${error.options.status ? ` (HTTP ${error.options.status})` : ''}`
  return error instanceof Error ? error.message : String(error)
}
