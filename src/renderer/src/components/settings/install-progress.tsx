import { LoaderCircle, TriangleAlert } from 'lucide-react'
import { Progress } from '@/components/ui/progress'
import { describeInstall, installPercent } from '@/lib/ffmpeg-install'
import type { FfmpegInstallState } from '@shared/ffmpeg'

/** Barra e texto do que a instalação do FFmpeg está fazendo (ou o erro). */
export function InstallProgress({ state }: { state: FfmpegInstallState }) {
  if (state.phase === 'error') {
    return (
      <p role="alert" className="text-destructive flex items-start gap-1.5 text-sm">
        <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
        {describeInstall(state)}
      </p>
    )
  }
  const percent = installPercent(state)
  return (
    <div className="space-y-2">
      {percent === null ? (
        <div className="text-muted-foreground flex items-center gap-2 text-sm">
          <LoaderCircle className="size-4 animate-spin" aria-hidden />
          <span role="status">{describeInstall(state)}</span>
        </div>
      ) : (
        <>
          <Progress value={percent} aria-label="Andamento da instalação do FFmpeg" />
          <p className="text-muted-foreground text-sm" role="status">
            {describeInstall(state)}
          </p>
        </>
      )}
    </div>
  )
}
