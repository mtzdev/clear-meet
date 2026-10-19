import type { RecordingError, Result } from '@shared/recording'
import {
  makeSummaryView,
  SUMMARY_SCHEMA_VERSION,
  type SummaryChangedEvent,
  type SummaryFile,
  type SummaryMeta
} from '@shared/summary'
import { sameFolder } from '../../meetings/paths'
import { isDirectChild, listMeetingFolders, readMeeting } from '../../meetings/repository'
import { updateSummaryMeta, writeSummary } from '../../meetings/summary-store'
import { readTranscript } from '../../meetings/transcript-store'
import { AI_MESSAGES, isAiError } from '../errors'
import { formatMeetingForAi } from '../text/format'
import {
  SUMMARY_RESPONSE_SCHEMA,
  SUMMARY_SCHEMA_NAME,
  SUMMARY_SYSTEM_PROMPT
} from '../text/prompts'
import type { TextRequest, TextResult } from '../text/types'
import { parseSummaryResponse, SummaryParseError } from './parse'

/** O que o Resumo usa do roteador de texto (permite testar sem rede). */
export interface SummaryTextRouter {
  hasProvider(): boolean
  run(request: TextRequest, signal: AbortSignal): Promise<TextResult>
}

export interface SummaryDeps {
  meetingsDir(): string
  router: SummaryTextRouter
  emit(event: SummaryChangedEvent): void
  now(): number
  log(message: string): void
}

interface Job {
  folder: string
  meetingId: string
  controller: AbortController
  meta: SummaryMeta
  /** Estado a restaurar se o usuário cancelar (um Resumo pronto que está sendo refeito). */
  previous: SummaryMeta | undefined
}

const PARSE_ATTEMPTS = 2
const MAX_OUTPUT_TOKENS = 4096

function fail(code: RecordingError['code'], message: string): { ok: false; error: RecordingError } {
  return { ok: false, error: { code, message } }
}

/**
 * Resumo em segundo plano no main: monta a Transcrição como texto, pede à IA um JSON
 * estruturado, valida e grava `summary.json`. Um Resumo por vez; navegar na UI não o interrompe.
 */
export class SummaryService {
  private job: Job | null = null

  constructor(private readonly deps: SummaryDeps) {}

  isActive(folder: string): boolean {
    return this.job !== null && sameFolder(this.job.folder, folder)
  }

  hasActive(): boolean {
    return this.job !== null
  }

  cancel(folder: string): void {
    if (this.job && sameFolder(this.job.folder, folder)) this.job.controller.abort()
  }

  async start(folder: string): Promise<Result<null>> {
    const root = this.deps.meetingsDir()
    if (!isDirectChild(root, folder)) {
      return fail('invalid-request', 'A pasta não está dentro da pasta das Reuniões.')
    }
    if (this.job) {
      return fail(
        'busy',
        this.isActive(folder)
          ? 'O Resumo desta Reunião já está sendo gerado.'
          : 'Outro Resumo está sendo gerado. Aguarde ele terminar.'
      )
    }
    if (!this.deps.router.hasProvider()) {
      return fail('no-api-key', 'Configure a chave do Gemini ou da Groq nas Configurações.')
    }
    const read = await readMeeting(folder)
    if (!read.ok) return fail('not-found', 'A Reunião não foi encontrada.')
    const meeting = read.value
    if (meeting.status !== 'ready' || meeting.transcript?.status !== 'ready') {
      return fail('invalid-request', 'O Resumo precisa da Transcrição pronta.')
    }
    const transcript = await readTranscript(folder)
    if (!transcript.ok) return fail(transcript.error.code, transcript.error.message)
    if (!transcript.value || transcript.value.utterances.length === 0) {
      return fail('invalid-request', 'A Transcrição está vazia: não há o que resumir.')
    }
    if (this.job) return fail('busy', 'Outro Resumo está sendo gerado. Aguarde ele terminar.')

    const job: Job = {
      folder,
      meetingId: meeting.id,
      controller: new AbortController(),
      meta: { status: 'running', updatedAt: this.stamp() },
      previous: meeting.summary
    }
    this.job = job
    try {
      await updateSummaryMeta(folder, () => job.meta)
    } catch {
      this.job = null
      return fail('unknown', 'Não foi possível salvar o estado do Resumo no disco.')
    }
    this.publish(job)

    const text = formatMeetingForAi(meeting, transcript.value, meeting.notes)
    void this.run(job, text, meeting.durationMs ?? transcript.value.durationMs)
    return { ok: true, value: null }
  }

  /**
   * "Transcrever + resumir": quando a Transcrição termina, gera o Resumo. Se não der para
   * começar, o motivo fica no estado do Resumo, onde a aba mostra o erro e "Tentar de novo".
   */
  async startAfterTranscript(folder: string): Promise<void> {
    const started = await this.start(folder)
    if (started.ok) return
    this.deps.log(`[resumo] não foi possível começar: ${started.error.code}`)
    const meeting = await updateSummaryMeta(folder, () => ({
      status: 'error',
      error: started.error.message,
      updatedAt: this.stamp()
    })).catch(() => null)
    if (meeting) {
      this.deps.emit({
        meetingId: meeting.id,
        folder,
        view: makeSummaryView(meeting.summary)
      })
    }
  }

  /** Ao abrir o app: um Resumo que ficou "em andamento" foi interrompido; vira erro retomável. */
  async recoverInterrupted(): Promise<void> {
    for (const folder of await listMeetingFolders(this.deps.meetingsDir())) {
      if (this.isActive(folder)) continue
      const read = await readMeeting(folder)
      if (!read.ok || read.value.summary?.status !== 'running') continue
      await updateSummaryMeta(folder, (previous) =>
        previous?.status === 'running'
          ? {
              status: 'error',
              error: 'O Resumo foi interrompido porque o app foi fechado. Tente de novo.',
              updatedAt: this.stamp()
            }
          : previous
      ).catch(() => undefined)
    }
  }

  private stamp(): string {
    return new Date(this.deps.now()).toISOString()
  }

  private publish(job: Job): void {
    this.deps.emit({
      meetingId: job.meetingId,
      folder: job.folder,
      view: makeSummaryView(job.meta)
    })
  }

  private async settle(job: Job, meta: SummaryMeta | undefined): Promise<void> {
    try {
      await updateSummaryMeta(job.folder, () => meta)
    } catch (error) {
      this.deps.log(`[resumo] não foi possível gravar o estado final: ${describe(error)}`)
    }
    job.meta = meta ?? { status: 'none', updatedAt: job.meta.updatedAt }
    this.job = null
    this.publish(job)
  }

  private async run(job: Job, context: string, durationMs: number | null): Promise<void> {
    const signal = job.controller.signal
    try {
      const request: TextRequest = {
        system: SUMMARY_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: context }],
        json: { name: SUMMARY_SCHEMA_NAME, schema: SUMMARY_RESPONSE_SCHEMA },
        maxOutputTokens: MAX_OUTPUT_TOKENS
      }
      let summary: SummaryFile | null = null
      for (let attempt = 1; summary === null; attempt++) {
        const result = await this.deps.router.run(request, signal)
        try {
          const content = parseSummaryResponse(result.text, durationMs)
          summary = {
            schemaVersion: SUMMARY_SCHEMA_VERSION,
            provider: result.provider,
            model: result.model,
            createdAt: this.stamp(),
            ...content
          }
        } catch (error) {
          if (!(error instanceof SummaryParseError)) throw error
          this.deps.log(`[resumo] resposta inválida (tentativa ${attempt}): ${error.message}`)
          if (attempt >= PARSE_ATTEMPTS) {
            throw new FailedSummary(AI_MESSAGES['bad-response'])
          }
        }
      }
      await writeSummary(job.folder, summary)
      await this.settle(job, {
        status: 'ready',
        provider: summary.provider,
        model: summary.model,
        updatedAt: this.stamp()
      })
    } catch (error) {
      if (signal.aborted) {
        await this.settle(job, job.previous?.status === 'ready' ? job.previous : undefined)
        return
      }
      this.deps.log(`[resumo] falhou: ${describe(error)}`)
      const message = error instanceof FailedSummary || isAiError(error) ? error.message : null
      await this.settle(job, {
        status: 'error',
        error: message ?? AI_MESSAGES.unknown,
        updatedAt: this.stamp()
      })
    }
  }
}

class FailedSummary extends Error {}

/** Texto para o log: só o tipo e a mensagem, nunca cabeçalhos, chaves nem conteúdo da Reunião. */
function describe(error: unknown): string {
  if (isAiError(error)) {
    return `${error.kind}${error.options.status ? ` (HTTP ${error.options.status})` : ''}`
  }
  return error instanceof Error ? error.name : 'erro desconhecido'
}
