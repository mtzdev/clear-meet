import { CircleDot, LoaderCircle } from 'lucide-react'
import { useState } from 'react'
import { checkInputs, INPUTS_PROBLEM_TEXT, INPUTS_WARNING_TEXT } from '@shared/audio-inputs'
import { ActivePanel } from '@/components/record/active-panel'
import { AudioSection } from '@/components/record/audio-section'
import { FinishedPanel } from '@/components/record/finished-panel'
import { PreflightNotices, RecoveryBanner } from '@/components/record/notices'
import { QualitySection } from '@/components/record/quality-section'
import { RecentMeetings } from '@/components/record/recent-meetings'
import { SourcePicker } from '@/components/record/source-picker'
import { Screen } from '@/components/layout/screen'
import { Button } from '@/components/ui/button'
import { formatBytes } from '@/lib/format'
import { NO_MIC, resolveMicChoice, useMicDevices } from '@/lib/microphone'
import {
  useCaptureSources,
  usePreflight,
  useRecordingState,
  useRecoveryReport,
  useSettings
} from '@/lib/recording'
import { resolveSelection } from '@/lib/source-selection'
import type { CaptureSourceRef } from '@shared/recording'

export function RecordScreen() {
  const state = useRecordingState()
  const { settings, update } = useSettings()
  const { report, retry } = useRecoveryReport()
  const [dismissedAt, setDismissedAt] = useState<number | null>(null)
  const [chosen, setChosen] = useState<CaptureSourceRef | null>(null)
  const [startError, setStartError] = useState<string | null>(null)

  const idle = state.phase === 'idle'
  const starting = state.phase === 'starting'
  const showSetup = state.phase === 'idle' || state.phase === 'starting'
  const finished = state.phase === 'idle' ? state.finished : null
  const setupVisible = showSetup && finished === null

  const { sources, loading, error, refresh } = useCaptureSources(setupVisible && !starting)
  const mics = useMicDevices()
  const preflight = usePreflight(setupVisible)

  // Mesmo que "chosen" seja nulo ou a janela tenha fechado, a seleção efetiva é sempre válida.
  const selected = resolveSelection(chosen, sources)
  const micChoice = resolveMicChoice(settings?.micDeviceId ?? null, mics.devices)
  const quality = settings?.quality ?? '1080p'
  const systemAudio = settings?.systemAudio ?? true
  const blockedByDisk = preflight?.disk === 'critical'
  const micDevice =
    micChoice === NO_MIC ? undefined : mics.devices.find((item) => item.deviceId === micChoice)
  const inputs = checkInputs({
    hasVideo: selected.kind !== 'none',
    mic: micDevice !== undefined,
    systemAudio
  })

  const start = async () => {
    setStartError(null)
    const result = await window.api.invoke('recording:start', {
      source: selected,
      mic: micDevice ? { deviceId: micDevice.deviceId, label: micDevice.label } : null,
      systemAudio,
      quality
    })
    if (!result.ok) setStartError(result.error.message)
  }

  if (state.phase === 'recording' || state.phase === 'paused' || state.phase === 'finalizing') {
    return (
      <Screen title="Gravar">
        <ActivePanel state={state} />
      </Screen>
    )
  }

  if (finished) {
    return (
      <Screen title="Gravar">
        <FinishedPanel key={finished.meetingId} finished={finished} />
      </Screen>
    )
  }

  const showRecovery = report.checkedAt !== null && report.checkedAt !== dismissedAt

  return (
    <Screen title="Gravar">
      <div className="mx-auto max-w-6xl space-y-6 px-8 pt-6 pb-4">
        {showRecovery && (
          <RecoveryBanner
            report={report}
            onRetry={retry}
            onDismiss={() => setDismissedAt(report.checkedAt)}
          />
        )}
        <PreflightNotices info={preflight} />

        <div className="grid gap-8 min-[980px]:grid-cols-[minmax(0,1fr)_19rem]">
          <SourcePicker
            sources={sources}
            loading={loading}
            error={error}
            selected={selected}
            disabled={starting}
            onSelect={setChosen}
            onRefresh={refresh}
          />
          <div className="space-y-8 min-[980px]:sticky min-[980px]:top-0 min-[980px]:self-start">
            <AudioSection
              devices={mics.devices}
              problem={mics.problem}
              choice={micChoice}
              systemAudio={systemAudio}
              disabled={starting}
              onChange={(value) => update({ micDeviceId: value })}
              onSystemAudioChange={(enabled) => update({ systemAudio: enabled })}
            />
            <QualitySection
              value={quality}
              disabled={starting || selected.kind === 'none'}
              onChange={(value) => update({ quality: value })}
            />
          </div>
        </div>

        <RecentMeetings />
      </div>

      <div className="bg-background/90 border-border sticky bottom-0 border-t backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-8 py-4">
          <div className="min-w-0 text-sm">
            {startError ? (
              <p className="text-destructive">{startError}</p>
            ) : !inputs.ok ? (
              <p className="text-warning truncate">{INPUTS_PROBLEM_TEXT[inputs.problem]}</p>
            ) : inputs.warning ? (
              <p className="text-warning truncate">{INPUTS_WARNING_TEXT[inputs.warning]}</p>
            ) : (
              <p className="text-muted-foreground truncate">
                {idle && preflight?.freeBytes != null
                  ? `Espaço livre: ${formatBytes(preflight.freeBytes)}`
                  : 'Pronto para gravar.'}
              </p>
            )}
          </div>
          <Button
            size="lg"
            className="bg-record hover:bg-record/90 min-w-52 text-white"
            disabled={starting || blockedByDisk || !idle || !inputs.ok}
            onClick={() => void start()}
          >
            {starting ? (
              <LoaderCircle className="animate-spin" aria-hidden />
            ) : (
              <CircleDot aria-hidden />
            )}
            {starting ? 'Iniciando…' : 'Iniciar gravação'}
          </Button>
        </div>
      </div>
    </Screen>
  )
}
