import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { CAPTURE_FPS, isQualityPreset, resolveCanvasSize } from '@shared/capture'
import {
  clockElapsedMs,
  clockPause,
  clockResume,
  clockStart,
  isClockRunning,
  type ClockSnapshot
} from '@shared/clock'
import {
  MEETING_FILES,
  MEETING_SCHEMA_VERSION,
  type MeetingFile,
  type MeetingNote
} from '@shared/meeting'
import { insertNote, normalizeNoteText } from '@shared/notes'
import type {
  RecorderChunkKind,
  RecorderCommand,
  RecorderEvent,
  RecorderResults,
  RecorderStartParams,
  RecorderCommandName
} from '@shared/recorder'
import {
  assessDisk,
  DISK_ABORT_BYTES,
  DISK_LOW_BYTES,
  IDLE_STATE,
  type ActiveMeeting,
  type AudioLevels,
  type CaptureSourceRef,
  type FinishedRecording,
  type RecordingError,
  type RecordingErrorCode,
  type RecordingState,
  type RecordingWarning,
  type Result,
  type StartRecordingRequest,
  type StopReason
} from '@shared/recording'
import type { AppSettings } from '@shared/settings'
import { parseWindowHandle, type WindowStateProbe } from '../capture/window-state'
import type { FfmpegTools, RunProcess } from '../ffmpeg/media'
import { createUniqueFolder, meetingFolderBase, suggestMeetingName } from '../meetings/folder-name'
import { newMeetingId, writeMeeting } from '../meetings/repository'
import { applyFinalize, finalizeParts } from './finalize'
import { PartWriter } from './part-writer'

/** Janela de gravação (oculta) vista pelo serviço; a implementação real usa um `BrowserWindow`. */
export interface RecorderSession {
  send<C extends RecorderCommandName>(
    command: Extract<RecorderCommand, { name: C }>
  ): Promise<RecorderResults[C]>
  destroy(): void
}

/** O que a janela de gravação entrega ao serviço. */
export interface RecorderSink {
  chunk(kind: RecorderChunkKind, data: ArrayBuffer): Promise<void>
  event(event: RecorderEvent): void
  /** O processo da janela morreu ou ela foi fechada. */
  crashed(reason: string): void
}

export interface ServiceEvents {
  'recording:state': RecordingState
  'recording:level': AudioLevels
}

export interface RecordingServiceDeps {
  config(): { settings: AppSettings; meetingsDir: string }
  getTools(): Promise<FfmpegTools | null>
  createRecorder(sink: RecorderSink): Promise<RecorderSession>
  /**
   * Escolhe a fonte que o próximo `getDisplayMedia` da janela de gravação vai receber.
   * Devolve `null` se ela não existe mais. `null` na entrada limpa a escolha.
   */
  selectSource(source: CaptureSourceRef | null): Promise<boolean>
  emit<E extends keyof ServiceEvents>(event: E, payload: ServiceEvents[E]): void
  freeBytes(dir: string): Promise<number | null>
  /** Impede o Windows de suspender durante a gravação; devolve a função que libera. */
  keepAwake(): () => void
  /**
   * Consulta o estado da janela gravada (minimizada, fechada). Sem ela, o aviso de janela
   * minimizada não existe.
   */
  windowState?: WindowStateProbe
  now(): number
  run?: RunProcess
  log?(message: string): void
}

const DISK_CHECK_INTERVAL_MS = 30_000
const WINDOW_CHECK_INTERVAL_MS = 1000
const START_TIMEOUT_MS = 30_000
const STOP_TIMEOUT_MS = 30_000

function fail(code: RecordingErrorCode, message: string): { ok: false; error: RecordingError } {
  return { ok: false, error: { code, message } }
}

function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`${what}: tempo esgotado`)), ms)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

interface ActiveSession {
  folder: string
  meeting: MeetingFile
  info: ActiveMeeting
  clock: ClockSnapshot | null
  recorder: RecorderSession | null
  writers: { video: PartWriter | null; audio: PartWriter }
  warnings: Set<RecordingWarning>
  /** Fila de gravações do `meeting.json` da sessão (cada uma grava o estado mais recente). */
  persisting: Promise<void>
  stopping: Promise<Result<FinishedRecording>> | null
  diskTimer: NodeJS.Timeout | null
  windowTimer: NodeJS.Timeout | null
  releaseAwake: (() => void) | null
}

/**
 * Orquestra uma gravação: cria a pasta da Reunião, dirige a janela de gravação, escreve os
 * pedaços em disco, controla pausa/retomada (relógio dos Instantes) e, ao parar, faz o
 * pós-processamento. Toda a interação com o Electron entra por `RecordingServiceDeps`.
 */
export class RecordingService {
  private state: RecordingState = IDLE_STATE
  private session: ActiveSession | null = null

  constructor(private readonly deps: RecordingServiceDeps) {}

  getState(): RecordingState {
    return this.state
  }

  /** Pasta da Reunião em gravação, para a recuperação não tocar nela. */
  activeFolder(): string | null {
    return this.session?.folder ?? null
  }

  isBusy(): boolean {
    return this.state.phase !== 'idle'
  }

  private log(message: string): void {
    this.deps.log?.(`[recording] ${message}`)
  }

  private setState(state: RecordingState): void {
    this.state = state
    this.deps.emit('recording:state', state)
  }

  /** Reemite o estado `recording`/`paused` com o relógio e os avisos atuais. */
  private publishActive(): void {
    const session = this.session
    if (!session?.clock) return
    this.setState({
      phase: isClockRunning(session.clock) ? 'recording' : 'paused',
      meeting: session.info,
      clock: session.clock,
      warnings: [...session.warnings]
    })
  }

  acknowledge(): Promise<void> {
    if (this.state.phase === 'idle' && this.state.finished) this.setState(IDLE_STATE)
    return Promise.resolve()
  }

  // --- Início ------------------------------------------------------------------------------

  async start(request: StartRecordingRequest): Promise<Result<null>> {
    if (this.state.phase !== 'idle') {
      return fail('busy', 'Já existe uma gravação em andamento.')
    }
    const invalid = validateRequest(request)
    if (invalid) return fail('invalid-request', invalid)

    this.setState({ phase: 'starting' })
    const { settings, meetingsDir } = this.deps.config()
    let session: ActiveSession | null = null

    try {
      await mkdir(meetingsDir, { recursive: true })
      const free = await this.deps.freeBytes(meetingsDir)
      if (assessDisk(free) === 'critical') {
        return this.abortStart(
          null,
          fail('no-disk-space', 'Não há espaço livre suficiente no disco para gravar.')
        )
      }
      if (!(await this.deps.selectSource(request.source))) {
        return this.abortStart(
          null,
          fail(
            'source-unavailable',
            'A tela ou janela escolhida não está mais disponível. Atualize a lista e escolha de novo.'
          )
        )
      }

      const createdAt = new Date(this.deps.now())
      const hasVideo = request.source.kind !== 'none'
      const sourceName = request.source.kind === 'none' ? null : request.source.name
      const name = suggestMeetingName({ kind: request.source.kind, name: sourceName }, createdAt)
      const folder = await createUniqueFolder(meetingsDir, meetingFolderBase(createdAt, name))

      const plannedSize = resolveCanvasSize(request.quality, null)
      const meeting: MeetingFile = {
        schemaVersion: MEETING_SCHEMA_VERSION,
        id: newMeetingId(),
        name,
        createdAt: createdAt.toISOString(),
        endedAt: null,
        durationMs: null,
        status: 'recording',
        source: { kind: request.source.kind, name: sourceName },
        quality: request.quality,
        video: hasVideo ? { file: MEETING_FILES.video, ...plannedSize, fps: CAPTURE_FPS } : null,
        audio: { file: MEETING_FILES.audio },
        inputs: { mic: request.mic !== null, systemAudio: true },
        notes: [],
        issues: []
      }
      await writeMeeting(folder, meeting)

      session = {
        folder,
        meeting,
        info: {
          meetingId: meeting.id,
          folder,
          name,
          source: meeting.source,
          quality: request.quality,
          hasMic: false,
          hasSystemAudio: false,
          videoSize: null
        },
        clock: null,
        recorder: null,
        writers: {
          video: hasVideo ? await PartWriter.open(join(folder, MEETING_FILES.videoPart)) : null,
          audio: await PartWriter.open(join(folder, MEETING_FILES.audioPart))
        },
        warnings: new Set(),
        persisting: Promise.resolve(),
        stopping: null,
        diskTimer: null,
        windowTimer: null,
        releaseAwake: null
      }
      this.session = session

      session.recorder = await this.deps.createRecorder(this.sinkFor(session))
      const params: RecorderStartParams = {
        hasVideo,
        mic: request.mic,
        preset: request.quality,
        compaction: settings.compaction
      }
      const started = await withTimeout(
        session.recorder.send({ name: 'start', params }),
        START_TIMEOUT_MS,
        'Início da captura'
      )
      await this.deps.selectSource(null)

      // Instante zero = início do gravador de áudio; o relógio e o `meeting.json` partem dele.
      session.clock = clockStart(started.startedAt)
      session.info = {
        ...session.info,
        hasMic: started.hasMic,
        hasSystemAudio: started.hasSystemAudio,
        videoSize: started.video
          ? { width: started.video.width, height: started.video.height }
          : null
      }
      if (request.mic && !started.hasMic) session.warnings.add('mic-unavailable')
      session.meeting = {
        ...meeting,
        video: started.video
          ? {
              file: MEETING_FILES.video,
              width: started.video.width,
              height: started.video.height,
              fps: started.video.fps
            }
          : null,
        inputs: { mic: started.hasMic, systemAudio: started.hasSystemAudio }
      }
      await writeMeeting(folder, session.meeting)

      session.releaseAwake = this.deps.keepAwake()
      session.diskTimer = setInterval(() => void this.checkDisk(), DISK_CHECK_INTERVAL_MS)
      session.diskTimer.unref()
      this.watchWindow(session, request.source)
      this.log(
        `gravando "${name}" em ${folder} (${
          started.video
            ? `${started.video.width}x${started.video.height} ${started.video.mimeType}`
            : 'só áudio'
        }, ` +
          `mic=${String(started.hasMic)}, sistema=${String(started.hasSystemAudio)}${
            started.micProblem ? `, mic: ${started.micProblem}` : ''
          })`
      )
      this.publishActive()
      return { ok: true, value: null }
    } catch (error) {
      this.log(`falha ao iniciar: ${messageOf(error)}`)
      return this.abortStart(session, fail('recorder-failed', messageOf(error)))
    }
  }

  /** Desfaz um início que não deu certo: fecha tudo e apaga a pasta, que ainda não tem dados. */
  private async abortStart(
    session: ActiveSession | null,
    result: { ok: false; error: RecordingError }
  ): Promise<Result<null>> {
    session?.recorder?.destroy()
    if (session) {
      if (session.windowTimer) clearInterval(session.windowTimer)
      await session.writers.audio.close().catch(() => undefined)
      await session.writers.video?.close().catch(() => undefined)
      await rm(session.folder, { recursive: true, force: true }).catch(() => undefined)
    }
    this.session = null
    await this.deps.selectSource(null).catch(() => undefined)
    this.setState(IDLE_STATE)
    return result
  }

  // --- Durante a gravação ------------------------------------------------------------------

  private sinkFor(session: ActiveSession): RecorderSink {
    return {
      chunk: async (kind, data) => {
        const writer = kind === 'video' ? session.writers.video : session.writers.audio
        if (!writer) return
        try {
          await writer.write(new Uint8Array(data))
        } catch (error) {
          this.log(`erro ao gravar pedaço (${kind}): ${messageOf(error)}`)
          const full = (error as NodeJS.ErrnoException).code === 'ENOSPC'
          void this.stop(full ? 'low-disk' : 'write-error')
          throw error
        }
      },
      event: (event) => this.onRecorderEvent(session, event),
      crashed: (reason) => {
        this.log(`janela de gravação encerrou: ${reason}`)
        session.recorder = null
        void this.stop('recorder-crashed')
      }
    }
  }

  private onRecorderEvent(session: ActiveSession, event: RecorderEvent): void {
    if (this.session !== session) return
    switch (event.type) {
      case 'levels':
        this.deps.emit('recording:level', { mic: event.mic, system: event.system })
        break
      case 'video-stalled':
        this.onVideoStalled(session, event.stalled)
        break
      case 'source-ended':
        this.log('a fonte de vídeo terminou (janela fechada?); encerrando a gravação')
        void this.stop('source-ended')
        break
      case 'error':
        this.log(`erro na janela de gravação: ${event.message}`)
        break
      case 'ready':
        break
    }
  }

  /**
   * O codificador de vídeo travou (quadros entram, nenhum byte sai). Não há recuperação segura
   * que preserve o alinhamento com o Áudio da reunião, então só registra e avisa; o áudio segue.
   */
  private onVideoStalled(session: ActiveSession, stalled: boolean): void {
    if (!stalled) {
      if (session.warnings.delete('video-encoder-stalled')) this.publishActive()
      return
    }
    const atMs = session.clock ? clockElapsedMs(session.clock, this.deps.now()) : 0
    this.log(`o codificador de vídeo parou de emitir dados (aos ${Math.round(atMs / 1000)} s)`)
    session.warnings.add('video-encoder-stalled')
    session.meeting = {
      ...session.meeting,
      issues: [...session.meeting.issues, { code: 'video-encoder-stalled', atMs }]
    }
    void this.persist(session).catch(() => undefined)
    this.publishActive()
  }

  /**
   * Grava o `meeting.json` da sessão (o estado mais recente), em fila: duas escritas nunca se
   * atropelam e uma antiga nunca sobrescreve uma mais nova (Anotações, Ocorrências, parada).
   */
  private persist(session: ActiveSession): Promise<void> {
    const run = session.persisting.then(() => writeMeeting(session.folder, session.meeting))
    session.persisting = run.catch(() => undefined)
    return run
  }

  /**
   * Salva uma Anotação ao vivo no `meeting.json` (escrita atômica; sobrevive a um crash e a
   * Recuperação a preserva). `offsetMs` é o Instante já calculado (recuo incluído). Vale
   * gravando ou pausado; depois do pedido de parada a Anotação é recusada.
   */
  async addNote(text: string, offsetMs: number): Promise<Result<MeetingNote>> {
    const session = this.session
    const phase = this.state.phase
    if (!session || session.stopping || (phase !== 'recording' && phase !== 'paused')) {
      return fail('not-recording', 'Não há gravação em andamento para anotar.')
    }
    const clean = normalizeNoteText(text)
    if (clean === '') return fail('invalid-request', 'A Anotação está vazia.')
    if (!Number.isFinite(offsetMs)) return fail('invalid-request', 'Instante inválido.')

    const note: MeetingNote = {
      id: newMeetingId(),
      offsetMs: Math.max(0, Math.round(offsetMs)),
      text: clean,
      createdAt: new Date(this.deps.now()).toISOString()
    }
    const before = session.meeting
    session.meeting = { ...before, notes: insertNote(before.notes, note) }
    try {
      await this.persist(session)
    } catch (error) {
      this.log(`erro ao salvar a Anotação: ${messageOf(error)}`)
      session.meeting = {
        ...session.meeting,
        notes: session.meeting.notes.filter((existing) => existing.id !== note.id)
      }
      return fail('unknown', 'Não foi possível salvar a Anotação no disco.')
    }
    this.log(`Anotação salva (Instante ${note.offsetMs} ms)`)
    return { ok: true, value: note }
  }

  /**
   * Janela minimizada: a falta de quadros não serve de sinal (o Windows só entrega quadros
   * quando o conteúdo muda), então o estado da janela é consultado direto no sistema, 1x/s.
   * Pausada, não há o que avisar. Janela que não existe mais não é "minimizada": o fim da
   * fonte já encerra a gravação (`source-ended`).
   */
  private watchWindow(session: ActiveSession, source: CaptureSourceRef): void {
    const probe = this.deps.windowState
    const hwnd = source.kind === 'window' ? parseWindowHandle(source.id) : null
    if (!probe || hwnd === null) return
    session.windowTimer = setInterval(() => {
      if (this.session !== session || session.stopping || !session.clock) return
      if (!isClockRunning(session.clock)) return
      const minimized = probe(hwnd) === 'minimized'
      if (minimized === session.warnings.has('window-minimized')) return
      if (minimized) session.warnings.add('window-minimized')
      else session.warnings.delete('window-minimized')
      this.publishActive()
    }, WINDOW_CHECK_INTERVAL_MS)
    session.windowTimer.unref()
  }

  private async checkDisk(): Promise<void> {
    const session = this.session
    if (!session || session.stopping) return
    const free = await this.deps.freeBytes(session.folder)
    if (free === null || this.session !== session) return
    if (free < DISK_ABORT_BYTES) {
      this.log('espaço em disco esgotando; encerrando a gravação com segurança')
      void this.stop('low-disk')
    } else if (free < DISK_LOW_BYTES) {
      if (!session.warnings.has('low-disk')) {
        session.warnings.add('low-disk')
        this.publishActive()
      }
    } else if (session.warnings.delete('low-disk')) {
      this.publishActive()
    }
  }

  async pause(): Promise<Result<null>> {
    const session = this.session
    if (!session?.recorder || !session.clock || this.state.phase !== 'recording') {
      return fail('not-recording', 'Não há gravação em andamento para pausar.')
    }
    try {
      const { at } = await session.recorder.send({ name: 'pause' })
      session.clock = clockPause(session.clock, at)
      session.warnings.delete('window-minimized')
      this.publishActive()
      return { ok: true, value: null }
    } catch (error) {
      return fail('recorder-failed', messageOf(error))
    }
  }

  async resume(): Promise<Result<null>> {
    const session = this.session
    if (!session?.recorder || !session.clock || this.state.phase !== 'paused') {
      return fail('not-recording', 'A gravação não está pausada.')
    }
    try {
      const { at } = await session.recorder.send({ name: 'resume' })
      session.clock = clockResume(session.clock, at)
      this.publishActive()
      return { ok: true, value: null }
    } catch (error) {
      return fail('recorder-failed', messageOf(error))
    }
  }

  // --- Parada e pós-processamento ----------------------------------------------------------

  stop(reason: StopReason = 'user'): Promise<Result<FinishedRecording>> {
    const session = this.session
    if (!session || !session.clock) {
      return Promise.resolve(fail('not-recording', 'Não há gravação em andamento.'))
    }
    session.stopping ??= this.finish(session, reason)
    return session.stopping
  }

  private async finish(
    session: ActiveSession,
    reason: StopReason
  ): Promise<Result<FinishedRecording>> {
    const now = this.deps.now()
    const clock = clockPause(session.clock as ClockSnapshot, now)
    const durationFromClock = clockElapsedMs(clock, now)
    const issues: string[] = []
    this.setState({ phase: 'finalizing', meeting: session.info, clock })

    if (session.diskTimer) clearInterval(session.diskTimer)
    if (session.windowTimer) clearInterval(session.windowTimer)
    // Pede ao gravador que feche os arquivos: ele só responde depois de entregar o último pedaço.
    if (session.recorder) {
      try {
        await withTimeout(session.recorder.send({ name: 'stop' }), STOP_TIMEOUT_MS, 'Parada')
      } catch (error) {
        this.log(`parada do gravador: ${messageOf(error)}`)
        issues.push('O gravador não respondeu ao pedido de parada; o final pode ter sido cortado.')
      }
      session.recorder.destroy()
    }
    for (const writer of [session.writers.video, session.writers.audio]) {
      try {
        await writer?.close()
      } catch (error) {
        issues.push(`Erro ao gravar em disco: ${messageOf(error)}`)
      }
    }
    session.releaseAwake?.()
    // Anotações aceitas antes da parada terminam de ser gravadas antes do estado final.
    await session.persisting

    let meeting: MeetingFile = {
      ...session.meeting,
      status: 'processing',
      endedAt: new Date(now).toISOString(),
      durationMs: durationFromClock
    }
    try {
      await writeMeeting(session.folder, meeting)

      const tools = await this.deps.getTools()
      if (!tools) {
        meeting = { ...meeting, status: 'unprocessed' }
        issues.push(
          'FFmpeg indisponível: os arquivos finais serão gerados quando ele estiver instalado.'
        )
      } else {
        const outcome = await finalizeParts(session.folder, tools, this.deps.run)
        meeting = applyFinalize(meeting, outcome, meeting.endedAt ?? new Date(now).toISOString())
        issues.push(...outcome.issues)
      }
      await writeMeeting(session.folder, meeting)
    } catch (error) {
      this.log(`erro no pós-processamento: ${messageOf(error)}`)
      issues.push(messageOf(error))
      meeting = { ...meeting, status: 'unprocessed' }
      await writeMeeting(session.folder, meeting).catch(() => undefined)
    }

    const finished: FinishedRecording = {
      meetingId: meeting.id,
      folder: session.folder,
      name: meeting.name,
      durationMs: meeting.durationMs ?? durationFromClock,
      status: meeting.status === 'ready' ? 'ready' : 'unprocessed',
      hasVideo: meeting.video !== null,
      reason,
      issue: issues.length > 0 ? issues.join(' ') : null
    }
    this.log(`gravação encerrada (${reason}): ${finished.status}, ${finished.durationMs} ms`)
    this.session = null
    this.setState({ phase: 'idle', finished })
    return { ok: true, value: finished }
  }

  /** Atualiza o nome mostrado/salvo da Reunião que acabou de ser gravada (após renomear a pasta). */
  updateFinished(patch: { folder: string; name: string }, previousFolder: string): void {
    const state = this.state
    if (state.phase === 'idle' && state.finished?.folder === previousFolder) {
      this.setState({ phase: 'idle', finished: { ...state.finished, ...patch } })
    }
  }
}

/** O pedido vem da UI: confere a forma antes de usar. */
function validateRequest(request: StartRecordingRequest): string | null {
  const source = request.source as { kind?: unknown; id?: unknown; name?: unknown }
  if (source.kind !== 'none') {
    if (source.kind !== 'screen' && source.kind !== 'window') return 'Fonte de captura inválida.'
    if (typeof source.id !== 'string' || source.id === '' || typeof source.name !== 'string') {
      return 'Fonte de captura inválida.'
    }
  }
  if (!isQualityPreset(request.quality)) return 'Qualidade inválida.'
  const mic = request.mic as { deviceId?: unknown; label?: unknown } | null
  if (mic !== null && (typeof mic?.deviceId !== 'string' || typeof mic.label !== 'string')) {
    return 'Microfone inválido.'
  }
  return null
}
