import {
  AudioLines,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  CircleHelp,
  FileX2,
  Maximize,
  Minimize,
  Pause,
  Play,
  Volume1,
  Volume2,
  VolumeX,
  ZoomIn,
  ZoomOut
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Timeline } from '@/components/meeting/timeline'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { usePlayerValue, type PlayerController } from '@/lib/player-controller'
import { PLAYER_SHORTCUTS } from '@/lib/player-keys'
import { PLAYBACK_RATES } from '@/lib/player-prefs'
import { viewTransform } from '@/lib/player-view'
import { PortalContainerContext } from '@/lib/portal-container'
import { useFullscreen } from '@/lib/use-fullscreen'
import { usePlayerShortcuts } from '@/lib/use-player-shortcuts'
import { usePlayerView } from '@/lib/use-player-view'
import { cn } from '@/lib/utils'
import type { ContentArea } from '@shared/content-area'
import type { MeetingNote } from '@shared/meeting'
import { formatInstant, LONG_SEEK_STEP_MS, SEEK_STEP_MS } from '@shared/timeline'

export type PlayerMedia = { kind: 'video' | 'audio'; src: string | null } | { kind: 'none' }

interface MediaPlayerProps {
  controller: PlayerController
  media: PlayerMedia
  notes: readonly MeetingNote[]
  audioOnlyText: string
  /** Área útil do vídeo (sem faixas pretas gravadas), quando já foi detectada. */
  contentArea?: ContentArea | null
}

/** Em tela cheia, os controles somem depois deste tempo sem mexer o mouse (ms). */
const IDLE_HIDE_MS = 3000

function IconButton({
  label,
  hint,
  onClick,
  disabled,
  children
}: {
  label: string
  hint?: string
  onClick: () => void
  disabled?: boolean
  children: ReactNode
}) {
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label={label}
      title={hint ? `${label} (${hint})` : label}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </Button>
  )
}

function formatRate(rate: number): string {
  return `${String(rate).replace('.', ',')}×`
}

function RateMenu({ rate, onChange }: { rate: number; onChange: (rate: number) => void }) {
  const [open, setOpen] = useState(false)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="w-14 tabular-nums"
          aria-label={`Velocidade ${formatRate(rate)}`}
          title="Velocidade"
        >
          {formatRate(rate)}
        </Button>
      </PopoverTrigger>
      <PopoverContent side="top" align="end" className="w-24 p-1">
        <ul className="flex flex-col">
          {PLAYBACK_RATES.map((option) => (
            <li key={option}>
              <Button
                variant={option === rate ? 'secondary' : 'ghost'}
                size="sm"
                className="w-full justify-start tabular-nums"
                aria-pressed={option === rate}
                onClick={() => {
                  onChange(option)
                  setOpen(false)
                }}
              >
                {formatRate(option)}
              </Button>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  )
}

function ShortcutsHelp({ video }: { video: boolean }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label="Atalhos do teclado" title="Atalhos">
          <CircleHelp aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent side="top" align="end" className="w-auto p-3">
        <p className="mb-2 text-sm font-medium">Atalhos</p>
        <dl className="grid grid-cols-[auto_auto] gap-x-4 gap-y-1 text-xs">
          {PLAYER_SHORTCUTS.filter((shortcut) => video || !shortcut.video).map((shortcut) => (
            <div key={shortcut.keys} className="contents">
              <dt className="text-muted-foreground font-mono">{shortcut.keys}</dt>
              <dd>{shortcut.label}</dd>
            </div>
          ))}
        </dl>
      </PopoverContent>
    </Popover>
  )
}

function ControlsBar({
  controller,
  notes,
  video,
  fullscreen,
  hidden,
  onHover
}: {
  controller: PlayerController
  notes: readonly MeetingNote[]
  video: boolean
  fullscreen: { active: boolean; toggle: () => void }
  hidden: boolean
  onHover: (hovering: boolean) => void
}) {
  const paused = usePlayerValue(controller, (snapshot) => snapshot.paused)
  const muted = usePlayerValue(controller, (snapshot) => snapshot.muted)
  const volume = usePlayerValue(controller, (snapshot) => snapshot.volume)
  const rate = usePlayerValue(controller, (snapshot) => snapshot.rate)
  const seconds = usePlayerValue(controller, (snapshot) => Math.floor(snapshot.currentMs / 1000))
  const durationMs = usePlayerValue(controller, (snapshot) => snapshot.durationMs)

  const VolumeIcon = muted ? VolumeX : volume < 0.5 ? Volume1 : Volume2
  const short = SEEK_STEP_MS / 1000
  const long = LONG_SEEK_STEP_MS / 1000

  return (
    <div
      className={cn(
        'border-border bg-card @container flex flex-col gap-0.5 border-t px-3 py-1.5',
        fullscreen.active
          ? 'bg-card/90 absolute inset-x-0 bottom-0 backdrop-blur transition-opacity duration-200'
          : 'shrink-0',
        hidden && 'pointer-events-none opacity-0'
      )}
      onPointerEnter={() => onHover(true)}
      onPointerLeave={() => onHover(false)}
    >
      <div className="flex items-center gap-2">
        <span className="text-muted-foreground w-14 shrink-0 text-right text-xs tabular-nums">
          {formatInstant(seconds * 1000)}
        </span>
        <Timeline controller={controller} notes={notes} />
        <span className="text-muted-foreground w-14 shrink-0 text-xs tabular-nums">
          {formatInstant(durationMs)}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-x-0.5">
        <IconButton
          label={`Voltar ${long} s`}
          hint="J"
          onClick={() => controller.skip(-LONG_SEEK_STEP_MS)}
        >
          <ChevronsLeft aria-hidden />
        </IconButton>
        <IconButton
          label={`Voltar ${short} s`}
          hint="←"
          onClick={() => controller.skip(-SEEK_STEP_MS)}
        >
          <ChevronLeft aria-hidden />
        </IconButton>
        <IconButton
          label={paused ? 'Tocar' : 'Pausar'}
          hint="Espaço"
          onClick={() => controller.togglePlay()}
        >
          {paused ? <Play aria-hidden /> : <Pause aria-hidden />}
        </IconButton>
        <IconButton
          label={`Avançar ${short} s`}
          hint="→"
          onClick={() => controller.skip(SEEK_STEP_MS)}
        >
          <ChevronRight aria-hidden />
        </IconButton>
        <IconButton
          label={`Avançar ${long} s`}
          hint="L"
          onClick={() => controller.skip(LONG_SEEK_STEP_MS)}
        >
          <ChevronsRight aria-hidden />
        </IconButton>
        <span className="ml-2 flex items-center gap-0.5">
          <IconButton
            label={muted ? 'Ativar o som' : 'Silenciar'}
            hint="M"
            onClick={() => controller.toggleMuted()}
          >
            <VolumeIcon aria-hidden />
          </IconButton>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={muted ? 0 : volume}
            aria-label="Volume"
            className="accent-primary hidden h-1 w-20 cursor-pointer @md:block"
            onChange={(event) => controller.setVolume(Number(event.target.value))}
            onKeyDown={(event) => {
              // As setas ajustam o volume; o salto do player não deve disparar junto.
              if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') event.stopPropagation()
            }}
          />
        </span>
        <span className="flex-1" />
        <RateMenu rate={rate} onChange={(next) => controller.setRate(next)} />
        <ShortcutsHelp video={video} />
        {video && (
          <IconButton
            label={fullscreen.active ? 'Sair da tela cheia' : 'Tela cheia'}
            hint="F"
            onClick={fullscreen.toggle}
          >
            {fullscreen.active ? <Minimize aria-hidden /> : <Maximize aria-hidden />}
          </IconButton>
        )}
      </div>
    </div>
  )
}

function ZoomControls({
  label,
  zoomed,
  visible,
  onZoomIn,
  onZoomOut,
  onReset
}: {
  label: string
  zoomed: boolean
  visible: boolean
  onZoomIn: () => void
  onZoomOut: () => void
  onReset: () => void
}) {
  return (
    <div
      className={cn(
        'bg-background/80 text-foreground absolute top-2 right-2 flex items-center gap-0.5 rounded-md border p-0.5 text-xs shadow-xs backdrop-blur transition-opacity',
        zoomed
          ? 'opacity-100'
          : 'opacity-0 group-focus-within/stage:opacity-100 group-hover/stage:opacity-100',
        !visible && 'pointer-events-none opacity-0'
      )}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      <IconButton label="Diminuir o zoom" hint="−" disabled={!zoomed} onClick={onZoomOut}>
        <ZoomOut aria-hidden />
      </IconButton>
      <span className="w-10 text-center tabular-nums" aria-live="polite">
        {label}
      </span>
      <IconButton label="Aumentar o zoom" hint="+" onClick={onZoomIn}>
        <ZoomIn aria-hidden />
      </IconButton>
      <Button
        variant="ghost"
        size="sm"
        className="h-8 px-2"
        title="Ajustar à área (0)"
        disabled={!zoomed}
        onClick={onReset}
      >
        Ajustar
      </Button>
    </div>
  )
}

function Backdrop({ children }: { children: ReactNode }) {
  return (
    <div className="bg-muted/50 text-muted-foreground flex h-full w-full flex-col items-center justify-center gap-3 px-6 text-center">
      {children}
    </div>
  )
}

export function MediaPlayer({
  controller,
  media,
  notes,
  audioOnlyText,
  contentArea = null
}: MediaPlayerProps) {
  const error = usePlayerValue(controller, (snapshot) => snapshot.error)
  const src = media.kind === 'none' ? null : media.src
  const isVideo = media.kind === 'video'
  const attach = useCallback(
    (element: HTMLMediaElement | null) => controller.attach(element),
    [controller]
  )

  const [root, setRoot] = useState<HTMLDivElement | null>(null)
  const fullscreen = useFullscreen(root)
  const view = usePlayerView(controller, isVideo, contentArea)
  usePlayerShortcuts(
    controller,
    media.kind !== 'none',
    isVideo
      ? {
          fullscreen: fullscreen.toggle,
          zoomIn: view.zoomIn,
          zoomOut: view.zoomOut,
          zoomReset: view.reset
        }
      : null
  )

  // Em tela cheia os controles se escondem com o mouse parado (nunca com o vídeo pausado
  // nem com o mouse sobre eles).
  const [awake, setAwake] = useState(true)
  const hovering = useRef(false)
  useEffect(() => {
    if (!fullscreen.active) return
    let timer = 0
    const schedule = (): void => {
      window.clearTimeout(timer)
      timer = window.setTimeout(() => {
        if (hovering.current || controller.getSnapshot().paused) schedule()
        else setAwake(false)
      }, IDLE_HIDE_MS)
    }
    const wake = (): void => {
      setAwake(true)
      schedule()
    }
    schedule()
    window.addEventListener('pointermove', wake)
    window.addEventListener('pointerdown', wake)
    window.addEventListener('keydown', wake)
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('pointermove', wake)
      window.removeEventListener('pointerdown', wake)
      window.removeEventListener('keydown', wake)
      setAwake(true)
    }
  }, [fullscreen.active, controller])
  const controlsHidden = fullscreen.active && !awake

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
    <PortalContainerContext value={root}>
      <div
        ref={setRoot}
        className={cn(
          'flex h-full min-h-0 flex-col',
          fullscreen.active && 'relative bg-black',
          controlsHidden && 'cursor-none'
        )}
      >
        <div
          ref={isVideo ? view.setStage : undefined}
          className={cn(
            'group/stage relative min-h-0 min-w-0 flex-1 overflow-hidden bg-black select-none',
            isVideo && 'touch-none',
            isVideo && view.zoomed && (view.dragging ? 'cursor-grabbing' : 'cursor-grab')
          )}
          {...(isVideo ? view.bind : {})}
        >
          {isVideo ? (
            <>
              <div
                className={cn(
                  'absolute inset-0 origin-top-left',
                  view.settling && 'transition-transform duration-300 ease-out'
                )}
                style={{ transform: viewTransform(view.view) }}
              >
                <video
                  ref={attach}
                  src={src ?? undefined}
                  preload="metadata"
                  playsInline
                  className="absolute inset-0 h-full w-full object-contain"
                />
              </div>
              <ZoomControls
                label={view.zoomLabel}
                zoomed={view.zoomed}
                visible={!controlsHidden}
                onZoomIn={view.zoomIn}
                onZoomOut={view.zoomOut}
                onReset={view.reset}
              />
            </>
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
        <ControlsBar
          controller={controller}
          notes={notes}
          video={isVideo}
          fullscreen={fullscreen}
          hidden={controlsHidden}
          onHover={(over) => {
            hovering.current = over
          }}
        />
      </div>
    </PortalContainerContext>
  )
}
