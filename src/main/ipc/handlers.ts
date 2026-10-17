import type { AiProvider, AiStatus, KeyTestResult } from '@shared/ai'
import type { ChatSent, ChatState } from '@shared/chat'
import type { CleanupPreview, CleanupRequest, CleanupResult } from '@shared/cleanup'
import type { FfmpegStatus } from '@shared/ffmpeg'
import type { FloatingInfo } from '@shared/floating'
import type { IpcHandlers } from '@shared/ipc'
import type { LibraryQuery, LibraryResult, MeetingDetail } from '@shared/library'
import type { MeetingNote } from '@shared/meeting'
import type {
  CaptureSourceInfo,
  ListSourcesRequest,
  FinishedRecording,
  PreflightInfo,
  RecordingState,
  RecoveryReport,
  RenamedMeeting,
  Result,
  StartRecordingRequest
} from '@shared/recording'
import type { SettingsPatch, SettingsView } from '@shared/settings'
import type { SummaryFile } from '@shared/summary'
import type { TranscriptFile } from '@shared/transcript'

/** Dependências dos handlers; no app vêm do Electron e dos serviços do main. */
export interface HandlerDeps {
  getAppVersion(): string
  getFfmpegStatus(): Promise<FfmpegStatus>
  listSources(request: ListSourcesRequest): Promise<CaptureSourceInfo[]>
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
  deleteMeeting(folder: string): Promise<Result<null>>
  deleteMeetingVideo(folder: string): Promise<Result<{ freedBytes: number }>>
  retryCompaction(folder: string): Promise<Result<null>>
  cleanup: {
    preview(request: CleanupRequest): Promise<Result<CleanupPreview>>
    run(request: CleanupRequest): Promise<Result<CleanupResult>>
  }
  library: {
    search(query: LibraryQuery): Promise<LibraryResult>
    refresh(): Promise<void>
    notes(id: string): Promise<Result<MeetingNote[]>>
  }
  meetings: {
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
  summary: {
    get(folder: string): Promise<Result<SummaryFile | null>>
    start(folder: string): Promise<Result<null>>
    cancel(folder: string): void
  }
  chat: {
    get(folder: string): Promise<Result<ChatState>>
    send(folder: string, text: string | null): Promise<Result<ChatSent>>
    stop(folder: string): void
    clear(folder: string): Promise<Result<null>>
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
    'capture:listSources': (request) => deps.listSources(request),
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
    'meeting:delete': (request) => deps.deleteMeeting(request.folder),
    'meeting:deleteVideo': (request) => deps.deleteMeetingVideo(request.folder),
    'compaction:retry': (request) => deps.retryCompaction(request.folder),
    'cleanup:preview': (request) => deps.cleanup.preview(request),
    'cleanup:run': (request) => deps.cleanup.run(request),
    'library:search': (request) => deps.library.search(request),
    'library:refresh': async () => {
      await deps.library.refresh()
      return null
    },
    'library:notes': (request) => deps.library.notes(request.id),
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
    'summary:get': (request) => deps.summary.get(request.folder),
    'summary:start': (request) => deps.summary.start(request.folder),
    'summary:cancel': (request) => {
      deps.summary.cancel(request.folder)
      return null
    },
    'chat:get': (request) => deps.chat.get(request.folder),
    'chat:send': (request) => deps.chat.send(request.folder, request.text),
    'chat:stop': (request) => {
      deps.chat.stop(request.folder)
      return null
    },
    'chat:clear': (request) => deps.chat.clear(request.folder),
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
