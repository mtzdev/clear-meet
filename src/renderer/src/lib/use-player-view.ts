import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent
} from 'react'
import { areaMatchesFrame, type ContentArea } from '@shared/content-area'
import { usePlayerValue, type PlayerController } from './player-controller'
import {
  baseView,
  clampView,
  formatZoom,
  isZoomed,
  panBy,
  toggleZoomAt,
  viewSpace,
  wheelFactor,
  zoomBy,
  ZOOM_STEP,
  type PlayerView,
  type Point,
  type Size,
  type ViewSpace
} from './player-view'
import { useElementSize } from './use-element-size'

/** Deslocamento (px) a partir do qual o gesto vira arrasto e não clique. */
const DRAG_THRESHOLD_PX = 4
/** Duração da transição quando o enquadramento muda sozinho (a área útil chegou) (ms). */
const SETTLE_MS = 350

function center(size: Size): Point {
  return { x: size.width / 2, y: size.height / 2 }
}

/**
 * Zoom e arrasto do vídeo dentro da área do player. O vídeo ocupa a área inteira com
 * `object-fit: contain` (sempre completo); o zoom é uma transformação por cima disso. Com
 * `area` (sem as faixas pretas), o ajuste enquadra só ela e o zoom parte daí.
 */
export function usePlayerView(
  controller: PlayerController,
  enabled: boolean,
  area: ContentArea | null
) {
  const [stage, setStage] = useState<HTMLDivElement | null>(null)
  const stageSize = useElementSize(stage)
  const videoWidth = usePlayerValue(controller, (snapshot) => snapshot.videoWidth)
  const videoHeight = usePlayerValue(controller, (snapshot) => snapshot.videoHeight)
  // `null` = no ajuste (acompanha a janela e a área útil); senão, a visão do usuário.
  const [raw, setRaw] = useState<PlayerView | null>(null)
  const [dragging, setDragging] = useState(false)

  const usable = area && areaMatchesFrame(area, videoWidth, videoHeight) ? area : null
  const space = useMemo(
    () => viewSpace({ width: videoWidth, height: videoHeight }, stageSize, usable),
    [videoWidth, videoHeight, stageSize, usable]
  )
  const view = useMemo(() => (raw ? clampView(raw, space) : baseView(space)), [raw, space])

  // O enquadramento muda sozinho quando a área útil chega: anima em vez de dar um salto.
  const [seenArea, setSeenArea] = useState(usable)
  const [settling, setSettling] = useState(false)
  if (usable !== seenArea) {
    setSeenArea(usable)
    setSettling(true)
  }
  useEffect(() => {
    if (!settling) return
    const timer = window.setTimeout(() => setSettling(false), SETTLE_MS)
    return () => window.clearTimeout(timer)
  }, [settling])

  const latest = useRef<{ view: PlayerView; space: ViewSpace }>({ view, space })
  useLayoutEffect(() => {
    latest.current = { view, space }
  })
  const pointer = useRef<Point | null>(null)
  const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null)
  const suppressClick = useRef(false)

  const apply = useCallback((change: (current: PlayerView, space: ViewSpace) => PlayerView) => {
    const { view, space } = latest.current
    setRaw(change(view, space))
  }, [])

  const zoomIn = useCallback(() => {
    if (enabled) {
      apply((v, s) => zoomBy(v, ZOOM_STEP, pointer.current ?? center(s.stage), s))
    }
  }, [apply, enabled])
  const zoomOut = useCallback(() => {
    if (enabled) {
      apply((v, s) => zoomBy(v, 1 / ZOOM_STEP, pointer.current ?? center(s.stage), s))
    }
  }, [apply, enabled])
  const reset = useCallback(() => setRaw(null), [])

  // A roda precisa de `preventDefault` (Ctrl + roda dá zoom na página); o React registra
  // `wheel` como passivo, então o ouvinte é nativo.
  useEffect(() => {
    if (!stage || !enabled) return
    const onWheel = (event: WheelEvent): void => {
      event.preventDefault()
      const rect = stage.getBoundingClientRect()
      const at = { x: event.clientX - rect.left, y: event.clientY - rect.top }
      apply((v, s) => zoomBy(v, wheelFactor(event.deltaY, event.ctrlKey), at, s))
    }
    stage.addEventListener('wheel', onWheel, { passive: false })
    return () => stage.removeEventListener('wheel', onWheel)
  }, [stage, enabled, apply])

  const local = (event: { clientX: number; clientY: number }): Point => {
    const rect = stage?.getBoundingClientRect()
    return { x: event.clientX - (rect?.left ?? 0), y: event.clientY - (rect?.top ?? 0) }
  }

  const bind = {
    onPointerDown: (event: ReactPointerEvent<HTMLDivElement>): void => {
      if (event.button !== 0) return
      const { view, space } = latest.current
      if (!isZoomed(view, space)) return
      event.currentTarget.setPointerCapture(event.pointerId)
      drag.current = { x: event.clientX, y: event.clientY, moved: false }
    },
    onPointerMove: (event: ReactPointerEvent<HTMLDivElement>): void => {
      pointer.current = local(event)
      const current = drag.current
      if (!current) return
      const dx = event.clientX - current.x
      const dy = event.clientY - current.y
      if (!current.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return
      current.moved = true
      setDragging(true)
      current.x = event.clientX
      current.y = event.clientY
      apply((v, s) => panBy(v, dx, dy, s))
    },
    onPointerUp: (): void => {
      if (drag.current?.moved) {
        suppressClick.current = true
        window.setTimeout(() => {
          suppressClick.current = false
        }, 0)
      }
      drag.current = null
      setDragging(false)
    },
    onPointerLeave: (): void => {
      pointer.current = null
    },
    onClick: (event: ReactMouseEvent<HTMLDivElement>): void => {
      if (suppressClick.current) {
        suppressClick.current = false
        event.stopPropagation()
        return
      }
      controller.togglePlay()
    },
    onDoubleClick: (event: ReactMouseEvent<HTMLDivElement>): void => {
      if (!enabled) return
      const at = local(event)
      apply((v, s) => toggleZoomAt(v, at, s))
    }
  }

  return {
    setStage,
    view,
    zoomLabel: formatZoom(view, space),
    zoomed: isZoomed(view, space),
    settling: settling && raw === null,
    dragging,
    bind,
    zoomIn,
    zoomOut,
    reset
  }
}
