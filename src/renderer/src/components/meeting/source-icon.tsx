import { AppWindow, Mic, Monitor, type LucideIcon } from 'lucide-react'
import type { CaptureSourceKind } from '@shared/meeting'
import { SOURCE_KIND_LABEL } from '@/lib/meeting-text'
import { cn } from '@/lib/utils'

const ICONS: Record<CaptureSourceKind, LucideIcon> = {
  screen: Monitor,
  window: AppWindow,
  none: Mic
}

export function SourceIcon({ kind, className }: { kind: CaptureSourceKind; className?: string }) {
  const Icon = ICONS[kind]
  return (
    <Icon className={cn('size-4', className)} aria-label={SOURCE_KIND_LABEL[kind]} role="img" />
  )
}
