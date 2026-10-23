import type { AiProvider, AiStatus, KeyTestResult } from '@shared/ai'
import type { ChatSent, ChatState } from '@shared/chat'
import type { CleanupPreview, CleanupRequest, CleanupResult } from '@shared/cleanup'
import type { ContentArea } from '@shared/content-area'
import type { FfmpegInstallState, FfmpegStatus } from '@shared/ffmpeg'
import type { FloatingInfo } from '@shared/floating'
import type { GroupChatSent, GroupChatState, GroupScope, ScopeCandidate } from '@shared/group-chat'
import type { GroupInput, GroupsOverview, GroupWithApplied } from '@shared/groups'
import type { IpcChannel, IpcHandlers } from '@shared/ipc'
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
import type { MeetingsDirChoice, RelocationRequest, RelocationSummary } from '@shared/relocation'
import type { SettingsPatch, SettingsView } from '@shared/settings'
import type { SummaryFile } from '@shared/summary'
import type { TagInfo } from '@shared/tags'
import type { TranscriptFile } from '@shared/transcript'
import type { UpdateState } from '@shared/update'

/** Dependências dos handlers; no app vêm do Electron e dos serviços do main. */
export interface HandlerDeps {
  getAppVersion(): string
  getFfmpegStatus(): Promise<FfmpegStatus>
  installFfmpeg(): FfmpegInstallState
  /** Texto para o usuário enquanto a pasta das Reuniões está sendo trocada (nada deve mexer nas pastas); `null` fora disso. */
  relocationBlock(): string | null
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
  contentArea(folder: string): Promise<ContentArea | null>
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
    addTag(folder: string, name: string): Promise<Result<string[]>>
    removeTag(folder: string, name: string): Promise<Result<string[]>>
  }
  tags: {
    list(): Promise<TagInfo[]>
    create(name: string): Promise<Result<TagInfo>>
    rename(from: string, to: string): Promise<Result<{ name: string; updated: number }>>
    delete(name: string): Promise<Result<{ updated: number }>>
  }
  groups: {
    list(recheck: boolean): Promise<GroupsOverview>
    create(input: GroupInput, applyNow: boolean): Promise<Result<GroupWithApplied>>
    update(id: string, input: GroupInput, applyNow: boolean): Promise<Result<GroupWithApplied>>
    delete(id: string): Promise<Result<{ updated: number }>>
    reorder(ids: string[]): Promise<Result<null>>
    preview(id: string | null, rules: GroupInput['rules']): Promise<{ matching: number }>
    setGroup(folders: string[], groupId: string | null): Promise<Result<{ updated: number }>>
    autoAssign(folder: string): Promise<Result<{ groupId: string | null }>>
    acceptSuggestion(id: string): Promise<Result<GroupWithApplied>>
    dismissSuggestion(id: string): Promise<Result<null>>
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
  groupChat: {
    get(groupId: string): Promise<Result<GroupChatState>>
    meetings(groupId: string): Promise<Result<ScopeCandidate[]>>
    setScope(groupId: string, scope: GroupScope): Promise<Result<GroupScope>>
    send(groupId: string, text: string | null): Promise<Result<GroupChatSent>>
    stop(groupId: string): void
    clear(groupId: string): Promise<Result<null>>
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
    setNoteShortcut(accelerator: string): Promise<Result<SettingsView>>
  }
  meetingsDir: {
    choose(): Promise<Result<MeetingsDirChoice | null>>
    apply(request: RelocationRequest): Promise<Result<RelocationSummary>>
    cancel(): void
    open(which: 'current' | 'previous'): Promise<void>
  }
  update: {
    getState(): UpdateState
    restart(): Result<null>
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

/** Canais que mexem nas pastas das Reuniões: recusados enquanto a pasta das Reuniões é trocada. */
const FOLDER_CHANNELS = [
  'recording:start',
  'meeting:rename',
  'meeting:delete',
  'meeting:deleteVideo',
  'meeting:addNote',
  'meeting:updateNote',
  'meeting:deleteNote',
  'meeting:addTag',
  'meeting:removeTag',
  'tags:create',
  'tags:rename',
  'tags:delete',
  'groups:create',
  'groups:update',
  'groups:delete',
  'groups:reorder',
  'groups:setGroup',
  'groups:autoAssign',
  'groups:acceptSuggestion',
  'groups:dismissSuggestion',
  'compaction:retry',
  'cleanup:run',
  'transcript:start',
  'transcript:renameSpeaker',
  'summary:start',
  'chat:send',
  'chat:clear',
  'groupChat:setScope',
  'groupChat:send',
  'groupChat:clear'
] as const satisfies readonly IpcChannel[]

function blockDuringRelocation(deps: HandlerDeps, handlers: IpcHandlers): IpcHandlers {
  const guarded = { ...handlers } as unknown as Record<string, (request: unknown) => unknown>
  for (const channel of FOLDER_CHANNELS) {
    const inner = guarded[channel] as (request: unknown) => unknown
    guarded[channel] = (request) => {
      const message = deps.relocationBlock()
      return message ? { ok: false, error: { code: 'busy', message } } : inner(request)
    }
  }
  return guarded as unknown as IpcHandlers
}

export function createIpcHandlers(deps: HandlerDeps): IpcHandlers {
  return blockDuringRelocation(deps, {
    'app:getVersion': () => deps.getAppVersion(),
    'ffmpeg:status': () => deps.getFfmpegStatus(),
    'ffmpeg:install': () => deps.installFfmpeg(),
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
    'video:contentArea': (request) =>
      typeof request.folder === 'string' ? deps.contentArea(request.folder) : null,
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
    'meeting:addTag': (request) => deps.meetings.addTag(request.folder, request.name),
    'meeting:removeTag': (request) => deps.meetings.removeTag(request.folder, request.name),
    'tags:list': () => deps.tags.list(),
    'tags:create': (request) => deps.tags.create(request.name),
    'tags:rename': (request) => deps.tags.rename(request.from, request.to),
    'tags:delete': (request) => deps.tags.delete(request.name),
    'groups:list': (request) => deps.groups.list(request?.recheck === true),
    'groups:create': (request) => deps.groups.create(request, request?.applyNow === true),
    'groups:update': (request) =>
      deps.groups.update(request.id, request, request?.applyNow === true),
    'groups:delete': (request) => deps.groups.delete(request.id),
    'groups:reorder': (request) => deps.groups.reorder(request.ids),
    'groups:preview': (request) => deps.groups.preview(request.id, request.rules),
    'groups:setGroup': (request) => deps.groups.setGroup(request.folders, request.groupId),
    'groups:autoAssign': (request) => deps.groups.autoAssign(request.folder),
    'groups:acceptSuggestion': (request) => deps.groups.acceptSuggestion(request.id),
    'groups:dismissSuggestion': (request) => deps.groups.dismissSuggestion(request.id),
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
    'groupChat:get': (request) => deps.groupChat.get(request.groupId),
    'groupChat:meetings': (request) => deps.groupChat.meetings(request.groupId),
    'groupChat:setScope': (request) => deps.groupChat.setScope(request.groupId, request.scope),
    'groupChat:send': (request) => deps.groupChat.send(request.groupId, request.text),
    'groupChat:stop': (request) => {
      deps.groupChat.stop(request.groupId)
      return null
    },
    'groupChat:clear': (request) => deps.groupChat.clear(request.groupId),
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
    'settings:setNoteShortcut': (request) => deps.settings.setNoteShortcut(request.accelerator),
    'meetingsDir:choose': () => deps.meetingsDir.choose(),
    'meetingsDir:apply': (request) => deps.meetingsDir.apply(request),
    'meetingsDir:cancel': () => {
      deps.meetingsDir.cancel()
      return null
    },
    'meetingsDir:open': async (request) => {
      await deps.meetingsDir.open(request.which)
      return null
    },
    'update:getState': () => deps.update.getState(),
    'update:restart': () => deps.update.restart(),
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
  })
}
