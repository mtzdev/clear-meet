import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode
} from 'react'
import {
  clampSplit,
  DEFAULT_SPLIT,
  DIVIDER_PX,
  isStacked,
  loadSplit,
  saveSplit,
  SPLIT_KEY_STEP,
  splitFromPointer
} from '@/lib/split'
import { cn } from '@/lib/utils'

interface SplitLayoutProps {
  player: ReactNode
  panel: ReactNode
}

export function SplitLayout({ player, panel }: SplitLayoutProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  const [ratio, setRatio] = useState(loadSplit)
  const dragging = useRef(false)

  useEffect(() => {
    const element = containerRef.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(entry.contentRect.width)
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const stacked = width > 0 && isStacked(width)
  const effective = width > 0 ? clampSplit(ratio, width) : ratio

  const update = useCallback((value: number) => setRatio(value), [])

  const onPointerDown = (event: PointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return
    event.currentTarget.setPointerCapture(event.pointerId)
    dragging.current = true
  }
  const onPointerMove = (event: PointerEvent<HTMLDivElement>): void => {
    const rect = containerRef.current?.getBoundingClientRect()
    if (!dragging.current || !rect) return
    update(splitFromPointer(event.clientX - rect.left, rect.width))
  }
  const onPointerUp = (): void => {
    if (!dragging.current) return
    dragging.current = false
    saveSplit(effective)
  }
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    // O divisor focado usa as setas para si; o salto do player não deve disparar junto.
    event.preventDefault()
    event.stopPropagation()
    const next = clampSplit(
      effective + (event.key === 'ArrowLeft' ? -1 : 1) * SPLIT_KEY_STEP,
      width
    )
    update(next)
    saveSplit(next)
  }
  const reset = (): void => {
    update(DEFAULT_SPLIT)
    saveSplit(DEFAULT_SPLIT)
  }

  return (
    <div
      ref={containerRef}
      className={cn('flex min-h-0 flex-1', stacked ? 'flex-col' : 'flex-row')}
    >
      <div
        className={cn('min-h-0 min-w-0', stacked ? 'h-[45%] min-h-64 shrink-0' : 'shrink-0')}
        style={stacked ? undefined : { width: `calc((100% - ${DIVIDER_PX}px) * ${effective})` }}
      >
        {player}
      </div>

      {stacked ? (
        <div className="bg-border h-px shrink-0" aria-hidden />
      ) : (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Largura do player e do painel"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(effective * 100)}
          tabIndex={0}
          title="Arraste para ajustar. Clique duas vezes para restaurar."
          className="group/divider focus-visible:bg-accent hover:bg-accent relative shrink-0 cursor-col-resize touch-none outline-none"
          style={{ width: DIVIDER_PX }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onKeyDown={onKeyDown}
          onDoubleClick={reset}
        >
          <div className="bg-border group-hover/divider:bg-primary/40 group-focus-visible/divider:bg-primary absolute inset-y-0 left-1/2 w-px -translate-x-1/2" />
        </div>
      )}

      <div className="min-h-0 min-w-0 flex-1">{panel}</div>
    </div>
  )
}
