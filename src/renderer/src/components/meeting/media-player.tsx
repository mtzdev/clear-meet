import { AudioLines, FileX2, Pause, Play, Volume2, VolumeX } from 'lucide-react'
import { useCallback, useEffect } from 'react'
import { Timeline } from '@/components/meeting/timeline'
import { Button } from '@/components/ui/button'
import { PLAYBACK_RATES, usePlayerValue, type PlayerController } from '@/lib/player-controller'
import type { MeetingNote } from '@shared/meeting'
import { formatInstant } from '@shared/timeline'

export type PlayerMedia = { kind: 'video' | 'audio'; src: string | null } | { kind: 'none' }

interface MediaPlayerProps {
  controller: PlayerController
  media: PlayerMedia
  notes: readonly MeetingNote[]
  audioOnlyText: string
}

function ControlsBar({
  controller,
  notes
}: {
  controller: PlayerController
  notes: readonly MeetingNote[]
}) {
  const paused = usePlayerValue(controller, (snapshot) => snapshot.paused)
  const muted = usePlayerValue(controller, (snapshot) => snapshot.muted)
  const rate = usePlayerValue(controller, (snapshot) => snapshot.rate)
  const seconds = usePlayerValue(controller, (snapshot) => Math.floor(snapshot.currentMs / 1000))
  const durationMs = usePlayerValue(controller, (snapshot) => snapshot.durationMs)

  const nextRate = (): void => {
    const index = PLAYBACK_RATES.findIndex((candidate) => candidate === rate)
    controller.setRate(PLAYBACK_RATES[(index + 1) % PLAYBACK_RATES.length] ?? 1)
  }

  return (
    <div className="border-border bg-card flex shrink-0 items-center gap-2 border-t px-3 py-2">
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={paused ? 'Tocar' : 'Pausar'}
        onClick={() => controller.togglePlay()}
      >
        {paused ? <Play aria-hidden /> : <Pause aria-hidden />}
      </Button>
      <span className="text-muted-foreground w-[7.5rem] shrink-0 text-xs tabular-nums">
        {formatInstant(seconds * 1000)} / {formatInstant(durationMs)}
      </span>
      <Timeline controller={controller} notes={notes} />
      <Button
        variant="ghost"
        size="sm"
        className="w-12 tabular-nums"
        aria-label={`Velocidade ${rate}×. Clique para mudar`}
        onClick={nextRate}
      >
        {String(rate).replace('.', ',')}×
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={muted ? 'Ativar o som' : 'Silenciar'}
        onClick={() => controller.toggleMuted()}
      >
        {muted ? <VolumeX aria-hidden /> : <Volume2 aria-hidden />}
      </Button>
    </div>
  )
}

function Backdrop({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-muted/50 text-muted-foreground flex h-full w-full flex-col items-center justify-center gap-3 px-6 text-center">
      {children}
    </div>
  )
}

export function MediaPlayer({ controller, media, notes, audioOnlyText }: MediaPlayerProps) {
  const error = usePlayerValue(controller, (snapshot) => snapshot.error)
  const src = media.kind === 'none' ? null : media.src
  const attach = useCallback(
    (element: HTMLMediaElement | null) => controller.attach(element),
    [controller]
  )

  // Sem `src` o arquivo é solto de verdade (a pasta pode ser renomeada no Windows).
  useEffect(() => {
    if (src === null) controller.release()
  }, [src, controller])

  if (media.kind === 'none') {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <Backdrop>
          <FileX2 className="size-8" aria-hidden />
          <p className="max-w-xs text-sm">{audioOnlyText}</p>
        </Backdrop>
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="relative min-h-0 flex-1 bg-black">
        {media.kind === 'video' ? (
          <video
            ref={attach}
            src={src ?? undefined}
            preload="metadata"
            playsInline
            className="h-full w-full object-contain"
            onClick={() => controller.togglePlay()}
          />
        ) : (
          <>
            <audio ref={attach} src={src ?? undefined} preload="metadata" />
            <div className="bg-card absolute inset-0">
              <Backdrop>
                <AudioLines className="text-primary size-10" aria-hidden />
                <p className="max-w-xs text-sm">{audioOnlyText}</p>
              </Backdrop>
            </div>
          </>
        )}
        {error && (
          <div className="bg-background/90 text-destructive absolute inset-x-0 bottom-0 px-4 py-2 text-center text-sm">
            {error}
          </div>
        )}
      </div>
      <ControlsBar controller={controller} notes={notes} />
    </div>
  )
}
