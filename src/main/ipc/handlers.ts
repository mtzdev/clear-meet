import type { AiProvider, AiStatus, KeyTestResult } from '@shared/ai'
import type { FfmpegStatus } from '@shared/ffmpeg'
import type { FloatingInfo } from '@shared/floating'
import type { IpcHandlers } from '@shared/ipc'
import type { MeetingDetail, MeetingList } from '@shared/library'
import type { MeetingNote } from '@shared/meeting'
import type {
  CaptureSourceInfo,
  FinishedRecording,
  PreflightInfo,
  RecordingState,
  RecoveryReport,
  RenamedMeeting,
  Result,
  StartRecordingRequest
} from '@shared/recording'
import type { SettingsPatch, SettingsView } from '@shared/settings'
import type { TranscriptFile } from '@shared/transcript'

/** Dependências dos handlers; no app vêm do Electron e dos serviços do main. */
export interface HandlerDeps {
  getAppVersion(): string
  getFfmpegStatus(): Promise<FfmpegStatus>
  listSources(): Promise<CaptureSourceInfo[]>
  preflight(): Promise<PreflightInfo>
  recording: {
    getState(): RecordingState
    start(request: StartRecordingRequest): Promise<Result<null>>
    pause(): Promise<Result<null>>
    resume(): Promise<Result<null>>
    stop(): Promise<Result<FinishedRecording>>
    acknowledge(): Promise<void>
  }
  renameMeeting(folder: string, name: string): Promise<Result<RenamedMeeting>>
  revealMeeting(folder: string): Promise<void>
  meetings: {
    list(): Promise<MeetingList>
    get(id: string): Promise<Result<MeetingDetail>>
    addNote(folder: string, offsetMs: number, text: string): Promise<Result<MeetingNote>>
    updateNote(folder: string, noteId: string, text: string): Promise<Result<MeetingNote>>
    deleteNote(folder: string, noteId: string): Promise<Result<null>>
  }
  transcript: {
    get(folder: string): Promise<Result<TranscriptFile | null>>
    start(folder: string, requestSummary: boolean, model?: string): Promise<Result<null>>
    renameSpeaker(folder: string, speakerId: string, name: string): Promise<Result<TranscriptFile>>
    cancel(folder: string): void
  }
  ai: {
    getStatus(): AiStatus
    setKey(provider: AiProvider, key: string): Promise<Result<AiStatus>>
    clearKey(provider: AiProvider): Promise<AiStatus>
    testKey(provider: AiProvider, key: string | null): Promise<KeyTestResult>
  }
  openExternal(url: string): Promise<void>
  settings: {
    view(): SettingsView
    update(patch: SettingsPatch): Promise<SettingsView>
  }
  recovery: {
    getReport(): RecoveryReport
    retry(): Promise<RecoveryReport>
  }
  /** Barra flutuante e Anotações ao vivo. */
  floating: {
    getInfo(): FloatingInfo
    resizeBar(height: number): void
    showMain(): void
    openEditor(): void
    beginNote(): void
    saveNote(text: string): Promise<Result<null>>
    cancelNote(): void
  }
}

export function createIpcHandlers(deps: HandlerDeps): IpcHandlers {
  return {
    'app:getVersion': () => deps.getAppVersion(),
    'ffmpeg:status': () => deps.getFfmpegStatus(),
    'capture:listSources': () => deps.listSources(),
    'recording:preflight': () => deps.preflight(),
    'recording:getState': () => deps.recording.getState(),
    'recording:start': (request) => deps.recording.start(request),
    'recording:pause': () => deps.recording.pause(),
    'recording:resume': () => deps.recording.resume(),
    'recording:stop': () => deps.recording.stop(),
    'recording:acknowledge': async () => {
      await deps.recording.acknowledge()
      return null
    },
    'meeting:rename': (request) => deps.renameMeeting(request.folder, request.name),
    'meeting:reveal': async (request) => {
      await deps.revealMeeting(request.folder)
      return null
    },
    'meetings:list': () => deps.meetings.list(),
    'meeting:get': (request) => deps.meetings.get(request.id),
    'meeting:addNote': (request) =>
      deps.meetings.addNote(request.folder, request.offsetMs, request.text),
    'meeting:updateNote': (request) =>
      deps.meetings.updateNote(request.folder, request.noteId, request.text),
    'meeting:deleteNote': (request) => deps.meetings.deleteNote(request.folder, request.noteId),
    'transcript:get': (request) => deps.transcript.get(request.folder),
    'transcript:start': (request) =>
      deps.transcript.start(request.folder, request.requestSummary, request.model),
    'transcript:renameSpeaker': (request) =>
      deps.transcript.renameSpeaker(request.folder, request.speakerId, request.name),
    'transcript:cancel': (request) => {
      deps.transcript.cancel(request.folder)
      return null
    },
    'ai:getStatus': () => deps.ai.getStatus(),
    'ai:setKey': (request) => deps.ai.setKey(request.provider, request.key),
    'ai:clearKey': (request) => deps.ai.clearKey(request.provider),
    'ai:testKey': (request) => deps.ai.testKey(request.provider, request.key),
    'app:openExternal': async (request) => {
      await deps.openExternal(request.url)
      return null
    },
    'settings:get': () => deps.settings.view(),
    'settings:update': (patch) => deps.settings.update(patch),
    'recovery:getReport': () => deps.recovery.getReport(),
    'recovery:retry': () => deps.recovery.retry(),
    'floating:getInfo': () => deps.floating.getInfo(),
    'floating:resize': (request) => {
      deps.floating.resizeBar(request.height)
      return null
    },
    'floating:showMain': () => {
      deps.floating.showMain()
      return null
    },
    'notes:openEditor': () => {
      deps.floating.openEditor()
      return null
    },
    'notes:begin': () => {
      deps.floating.beginNote()
      return null
    },
    'notes:save': (request) => deps.floating.saveNote(request.text),
    'notes:cancel': () => {
      deps.floating.cancelNote()
      return null
    }
  }
}
