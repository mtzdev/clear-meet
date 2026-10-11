import {
  type BrowserWindow,
  desktopCapturer,
  screen,
  webContents,
  type DesktopCapturerSource,
  type Session,
  type WebContents
} from 'electron'
import type { CaptureSourceInfo, CaptureSourceRef } from '@shared/recording'

const THUMBNAIL = { width: 320, height: 180 }

type Pending = { kind: 'none' } | { kind: 'source'; id: string } | null

function kindOf(source: DesktopCapturerSource): 'screen' | 'window' {
  return source.id.startsWith('screen:') ? 'screen' : 'window'
}

/**
 * Telas e janelas disponíveis para gravar, com miniatura. `select` registra a que o
 * próximo `getDisplayMedia` da janela de gravação deve receber (sem seletor do sistema).
 */
export class CaptureSources {
  private pending: Pending = null

  /**
   * `isRecorder` identifica a janela de gravação: só ela pode abrir a captura.
   * `ownWindows` são as janelas do próprio app (não entram na lista: gravá-las não faz sentido).
   */
  constructor(
    private readonly isRecorder: (contents: WebContents | null) => boolean,
    private readonly ownWindows: () => BrowserWindow[]
  ) {}

  async list(): Promise<CaptureSourceInfo[]> {
    const own = new Set(
      this.ownWindows()
        .filter((window) => !window.isDestroyed())
        .map((window) => window.getMediaSourceId())
    )
    const sources = await desktopCapturer.getSources({
      types: ['screen', 'window'],
      thumbnailSize: THUMBNAIL,
      fetchWindowIcons: true
    })
    return sources
      .filter((source) => !own.has(source.id) && source.name.trim() !== '')
      .map((source) => ({
        id: source.id,
        kind: kindOf(source),
        name: source.name,
        thumbnail: source.thumbnail.isEmpty()
          ? null
          : `data:image/jpeg;base64,${source.thumbnail.toJPEG(70).toString('base64')}`,
        appIcon: source.appIcon && !source.appIcon.isEmpty() ? source.appIcon.toDataURL() : null
      }))
  }

  /** `true` se a fonte existe e foi escolhida; `null` limpa a escolha. */
  async select(ref: CaptureSourceRef | null): Promise<boolean> {
    if (ref === null) {
      this.pending = null
      return true
    }
    if (ref.kind === 'none') {
      this.pending = { kind: 'none' }
      return true
    }
    const sources = await desktopCapturer.getSources({
      types: [ref.kind],
      thumbnailSize: { width: 0, height: 0 }
    })
    if (!sources.some((source) => source.id === ref.id)) return false
    this.pending = { kind: 'source', id: ref.id }
    return true
  }

  /** Liga a escolha ao `getDisplayMedia` (vídeo da fonte + áudio do sistema em loopback). */
  install(session: Session): void {
    session.setDisplayMediaRequestHandler(
      (request, callback) => {
        const target = this.pending
        const caller = request.frame ? webContents.fromFrame(request.frame) : null
        if (!target || !this.isRecorder(caller ?? null)) return callback({})
        void this.resolve(target).then(
          (source) => callback(source ? { video: source, audio: 'loopback' } : {}),
          () => callback({})
        )
      },
      { useSystemPicker: false }
    )
  }

  private async resolve(target: Exclude<Pending, null>): Promise<DesktopCapturerSource | null> {
    const sources = await desktopCapturer.getSources({
      types: ['screen', 'window'],
      thumbnailSize: { width: 0, height: 0 }
    })
    if (target.kind === 'source') return sources.find((source) => source.id === target.id) ?? null
    // Só áudio: o `getDisplayMedia` exige um vídeo para entregar o loopback; usa a tela
    // principal e a janela de gravação descarta a trilha de vídeo em seguida.
    const primary = String(screen.getPrimaryDisplay().id)
    const screens = sources.filter((source) => kindOf(source) === 'screen')
    return screens.find((source) => source.display_id === primary) ?? screens[0] ?? null
  }
}
