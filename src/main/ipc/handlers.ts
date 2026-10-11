import type { FfmpegStatus } from '@shared/ffmpeg'
import type { IpcHandlers } from '@shared/ipc'
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
  settings: {
    view(): SettingsView
    update(patch: SettingsPatch): Promise<SettingsView>
  }
  recovery: {
    getReport(): RecoveryReport
    retry(): Promise<RecoveryReport>
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
    'settings:get': () => deps.settings.view(),
    'settings:update': (patch) => deps.settings.update(patch),
    'recovery:getReport': () => deps.recovery.getReport(),
    'recovery:retry': () => deps.recovery.retry()
  }
}
