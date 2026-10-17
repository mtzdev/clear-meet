import { createHash } from 'node:crypto'
import {
  type BrowserWindow,
  desktopCapturer,
  screen,
  webContents,
  type DesktopCapturerSource,
  type Session,
  type WebContents
} from 'electron'
import type { CaptureSourceInfo, CaptureSourceRef, ListSourcesRequest } from '@shared/recording'
import { isBlankBitmap, judgeWindow, rejectByPreview } from './filter'
import { NO_WINDOW_TOOLS, type WindowTraitsProbe } from './window-info'

const MIN_THUMBNAIL_WIDTH = 120
const MAX_THUMBNAIL_WIDTH = 480
const DEFAULT_THUMBNAIL_WIDTH = 240
const JPEG_QUALITY = 60
/** Capturar as miniaturas custa ~250 ms por janela: elas só se renovam depois deste intervalo... */
const THUMBNAILS_MIN_PERIOD_MS = 8_000
/** ...ou depois de tantas vezes a duração da última captura, o que for maior. */
const THUMBNAILS_DUTY_FACTOR = 2.5

const NO_THUMBNAILS = { width: 0, height: 0 }

/** `id: null` = Reunião só de áudio (sem fonte de vídeo). */
type Pending = { id: string | null; systemAudio: boolean } | null

const minimizedNow = (traits: ReturnType<WindowTraitsProbe>): boolean =>
  typeof traits === 'object' && traits !== null && traits.minimized

function clampWidth(width: number | undefined): number {
  if (typeof width !== 'number' || !Number.isFinite(width)) return DEFAULT_THUMBNAIL_WIDTH
  return Math.min(MAX_THUMBNAIL_WIDTH, Math.max(MIN_THUMBNAIL_WIDTH, Math.round(width)))
}

function kindOf(source: { id: string }): 'screen' | 'window' {
  return source.id.startsWith('screen:') ? 'screen' : 'window'
}

/** O que a última captura de miniaturas trouxe sobre uma fonte. */
interface Captured {
  minimizedAtCapture: boolean
  preview: { width: number; height: number; blank: boolean }
  key: string | null
  dataUrl: string | null
  icon: string | null
}

interface Listed {
  id: string
  kind: 'screen' | 'window'
  name: string
  minimized: boolean
  entry: Captured | null
}

/**
 * Telas e janelas disponíveis para gravar, com miniatura. `select` registra a que o
 * próximo `getDisplayMedia` da janela de gravação deve receber (sem seletor do sistema).
 */
export class CaptureSources {
  private pending: Pending = null
  private readonly captured = new Map<string, Captured>()
  private nextThumbnailsAt = 0
  private lastThumbnailsMs = 0
  private snapshot: { id: string; name: string }[] | null = null
  private refreshing: Promise<Listed[]> | null = null

  /**
   * `isRecorder` identifica a janela de gravação: só ela pode abrir a captura.
   * `ownWindows` são as janelas do próprio app (não entram na lista: gravá-las não faz sentido).
   */
  constructor(
    private readonly isRecorder: (contents: WebContents | null) => boolean,
    private readonly ownWindows: () => BrowserWindow[],
    private readonly windowTraits: WindowTraitsProbe = NO_WINDOW_TOOLS.traits
  ) {}

  async list(request: Partial<ListSourcesRequest> = {}): Promise<CaptureSourceInfo[]> {
    const width = clampWidth(request.thumbnailWidth)
    // Chamadas simultâneas dividem a mesma consulta (não há duas capturas ao mesmo tempo).
    this.refreshing ??= this.refresh(width, request.force === true).finally(() => {
      this.refreshing = null
    })
    const listed = await this.refreshing
    const known = request.known ?? {}
    return listed.map(({ id, kind, name, minimized, entry }): CaptureSourceInfo => {
      // Janela minimizada não é desenhada pelo Windows: a UI mostra o ícone do app no lugar.
      const key = minimized ? null : (entry?.key ?? null)
      const seen = known[id]
      return {
        id,
        kind,
        name,
        minimized,
        thumbKey: key,
        thumbnail: key !== null && seen !== key ? (entry?.dataUrl ?? null) : null,
        appIcon: seen === undefined ? (entry?.icon ?? null) : null
      }
    })
  }

  private ownIds(): Set<string> {
    return new Set(
      this.ownWindows()
        .filter((window) => !window.isDestroyed())
        .map((window) => window.getMediaSourceId())
    )
  }

  private async refresh(width: number, force: boolean): Promise<Listed[]> {
    // Cada consulta ao desktopCapturer custa ~0,3 s de CPU mesmo sem imagens, então a lista só é
    // pedida de novo quando as miniaturas vencem. Nesse meio tempo, o estado de cada janela
    // (minimizada, fechada) vem direto do Windows, que é barato.
    if (force || !this.snapshot || Date.now() >= this.nextThumbnailsAt) {
      this.snapshot = await this.captureThumbnails(width)
    }
    const ownIds = this.ownIds()
    const listed: Listed[] = []
    for (const source of this.snapshot) {
      const kind = kindOf(source)
      const entry = this.captured.get(source.id) ?? null
      if (kind === 'screen') {
        listed.push({ id: source.id, kind, name: source.name, minimized: false, entry })
        continue
      }
      const traits = this.windowTraits(source.id)
      if (traits === 'gone') continue
      // A captura feita com a janela minimizada não vale depois de ela voltar.
      const stale = entry !== null && entry.minimizedAtCapture && traits?.minimized === false
      const verdict = judgeWindow({
        id: source.id,
        name: source.name,
        ownIds,
        traits,
        preview: stale ? null : (entry?.preview ?? null)
      })
      if (verdict.reject !== null) continue
      listed.push({ id: source.id, kind, name: source.name, minimized: verdict.minimized, entry })
    }
    return listed
  }

  /** Captura as miniaturas de tudo e atualiza o cache. */
  private async captureThumbnails(width: number): Promise<{ id: string; name: string }[]> {
    const startedAt = Date.now()
    const sources = await desktopCapturer.getSources({
      types: ['screen', 'window'],
      thumbnailSize: { width, height: Math.round((width * 9) / 16) },
      fetchWindowIcons: true
    })
    const present = new Set(sources.map((source) => source.id))
    for (const id of this.captured.keys()) if (!present.has(id)) this.captured.delete(id)
    for (const source of sources) {
      const previous = this.captured.get(source.id)
      const image = source.thumbnail
      const size = image.getSize()
      let key: string | null = null
      let blank = false
      if (!image.isEmpty()) {
        const bitmap = image.toBitmap()
        key = createHash('sha1').update(bitmap).digest('base64url').slice(0, 12)
        blank = isBlankBitmap(bitmap, size.width, size.height)
      }
      const preview = { width: size.width, height: size.height, blank }
      const usable =
        key !== null && (kindOf(source) === 'screen' || rejectByPreview(preview) === null)
      // Imagem vazia ou preta (janela minimizada, por exemplo) não substitui a última boa.
      const keep = !usable && previous
      const dataUrl = keep
        ? previous.dataUrl
        : !usable
          ? null
          : key === previous?.key && previous.dataUrl
            ? previous.dataUrl
            : `data:image/jpeg;base64,${image.toJPEG(JPEG_QUALITY).toString('base64')}`
      const icon =
        previous?.icon ??
        (source.appIcon && !source.appIcon.isEmpty() ? source.appIcon.toDataURL() : null)
      this.captured.set(source.id, {
        minimizedAtCapture: minimizedNow(this.windowTraits(source.id)),
        preview,
        key: keep ? previous.key : usable ? key : null,
        dataUrl,
        icon
      })
    }
    const end = Date.now()
    this.lastThumbnailsMs = end - startedAt
    this.nextThumbnailsAt =
      end + Math.max(THUMBNAILS_MIN_PERIOD_MS, THUMBNAILS_DUTY_FACTOR * this.lastThumbnailsMs)
    return sources.map(({ id, name }) => ({ id, name }))
  }

  /**
   * `true` se a fonte existe e foi escolhida; `null` limpa a escolha. `systemAudio` diz se o
   * `getDisplayMedia` deve entregar também o áudio do sistema (loopback).
   */
  async select(ref: CaptureSourceRef | null, systemAudio = true): Promise<boolean> {
    if (ref === null) {
      this.pending = null
      return true
    }
    if (ref.kind === 'none') {
      this.pending = { id: null, systemAudio }
      return true
    }
    const sources = await desktopCapturer.getSources({
      types: [ref.kind],
      thumbnailSize: NO_THUMBNAILS
    })
    if (!sources.some((source) => source.id === ref.id)) return false
    this.pending = { id: ref.id, systemAudio }
    return true
  }

  /** Liga a escolha ao `getDisplayMedia` (vídeo da fonte e, se pedido, o áudio do sistema em loopback). */
  install(session: Session): void {
    session.setDisplayMediaRequestHandler(
      (request, callback) => {
        const target = this.pending
        const caller = request.frame ? webContents.fromFrame(request.frame) : null
        if (!target || !this.isRecorder(caller ?? null)) return callback({})
        void this.resolve(target).then(
          (source) => {
            if (!source) return callback({})
            if (target.systemAudio) callback({ video: source, audio: 'loopback' })
            else callback({ video: source })
          },
          () => callback({})
        )
      },
      { useSystemPicker: false }
    )
  }

  private async resolve(target: NonNullable<Pending>): Promise<DesktopCapturerSource | null> {
    const sources = await desktopCapturer.getSources({
      types: ['screen', 'window'],
      thumbnailSize: NO_THUMBNAILS
    })
    if (target.id !== null) return sources.find((source) => source.id === target.id) ?? null
    // Só áudio: o `getDisplayMedia` exige um vídeo para entregar o loopback; usa a tela
    // principal e a janela de gravação descarta a trilha de vídeo em seguida.
    const primary = String(screen.getPrimaryDisplay().id)
    const screens = sources.filter((source) => kindOf(source) === 'screen')
    return screens.find((source) => source.display_id === primary) ?? screens[0] ?? null
  }
}
