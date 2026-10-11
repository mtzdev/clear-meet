import { noteOffsetMs, normalizeNoteText } from '@shared/notes'
import {
  clampBarHeight,
  NOTE_WINDOW_SIZE,
  pickWorkArea,
  placeNoteWindow,
  resolveBarPosition,
  type FloatingInfo,
  type Point,
  type Rect
} from '@shared/floating'
import type { IpcEventName, IpcEventPayload } from '@shared/ipc'
import type { MeetingNote } from '@shared/meeting'
import type { RecordingError, RecordingState, Result } from '@shared/recording'
import type { AppSettings } from '@shared/settings'

/** A barra flutuante vista pelo controlador; a implementação real é um `BrowserWindow`. */
export interface BarHandle {
  getBounds(): Rect
  setHeight(height: number): void
  send<E extends IpcEventName>(event: E, payload: IpcEventPayload<E>): void
  close(): void
}

/** A janelinha do campo de Anotação. */
export interface NoteHandle {
  /** Mostra na posição e dá o foco do teclado a ela. */
  showFocused(position: Point): void
  hide(): void
  isVisible(): boolean
  send<E extends IpcEventName>(event: E, payload: IpcEventPayload<E>): void
  close(): void
}

export interface FloatingDeps {
  recording: {
    getState(): RecordingState
    addNote(text: string, offsetMs: number): Promise<Result<MeetingNote>>
  }
  settings(): Pick<AppSettings, 'noteShortcut' | 'noteLeadSeconds' | 'barPosition'>
  saveBarPosition(position: Point): void
  displays(): { workAreas: Rect[]; primary: Rect }
  createBar(position: Point, onMoved: (position: Point) => void): BarHandle
  createNote(): NoteHandle
  shortcuts: {
    /** `true` só se o atalho ficou realmente registrado para este app. */
    register(accelerator: string, callback: () => void): boolean
    unregister(accelerator: string): void
  }
  /** Janela que estava em primeiro plano (para devolver o foco ao fechar o campo). */
  foreground: { capture(): unknown; restore(token: unknown): void }
  mainWindow: { hide(): void; show(): void }
  /** Ícone na bandeja: existe só enquanto há gravação ativa (idempotente). */
  tray: { show(): void; hide(): void }
  now(): number
  log?(message: string): void
}

function fail(code: RecordingError['code'], message: string): { ok: false; error: RecordingError } {
  return { ok: false, error: { code, message } }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Coordena a barra flutuante e o campo de Anotação durante uma gravação (Fase 3): ao gravar,
 * esconde a janela principal e mostra a barra; ao parar, fecha tudo e devolve a principal.
 * O atalho global só existe enquanto grava. Toda a interação com o Electron entra por
 * `FloatingDeps`.
 */
export class FloatingController {
  private bar: BarHandle | null = null
  private note: NoteHandle | null = null
  private active = false
  /** A janela principal foi ocultada por nós (no início do pedido de gravação ou ao gravar). */
  private mainHidden = false
  private trayShown = false
  private registered: string | null = null
  private info: FloatingInfo
  /** Anotação em edição: `offsetMs` fica `null` até a primeira tecla. */
  private draft: { offsetMs: number | null } | null = null
  private previousForeground: unknown = null

  constructor(private readonly deps: FloatingDeps) {
    this.info = { shortcut: deps.settings().noteShortcut, shortcutRegistered: false }
  }

  private log(message: string): void {
    this.deps.log?.(`[floating] ${message}`)
  }

  getInfo(): FloatingInfo {
    return this.info
  }

  /** Reage ao estado da gravação: liga a barra ao gravar, desliga ao parar. */
  onRecordingState(state: RecordingState): void {
    // A principal some já no pedido de início, antes da captura começar, para não entrar no
    // começo do Vídeo. Se o início falhar (volta a ocioso sem gravar), ela reaparece.
    this.syncTray(state)
    if (state.phase === 'starting') this.hideMain()
    else if (state.phase === 'recording' || state.phase === 'paused') this.activate()
    else if (state.phase === 'finalizing' || state.phase === 'idle') {
      this.deactivate()
      this.restoreMain()
    }
  }

  /** Bandeja: do pedido de início até parar; some ao finalizar ou se o início falhar. */
  private syncTray(state: RecordingState): void {
    const wanted =
      state.phase === 'starting' || state.phase === 'recording' || state.phase === 'paused'
    if (wanted === this.trayShown) return
    this.trayShown = wanted
    try {
      if (wanted) this.deps.tray.show()
      else this.deps.tray.hide()
    } catch (error) {
      this.log(`erro no ícone da bandeja: ${messageOf(error)}`)
    }
  }

  private hideMain(): void {
    if (this.mainHidden) return
    this.mainHidden = true
    this.deps.mainWindow.hide()
  }

  private restoreMain(): void {
    if (!this.mainHidden) return
    this.mainHidden = false
    this.deps.mainWindow.show()
  }

  /** Repassa um evento (estado, nível) à barra. */
  forwardToBar<E extends IpcEventName>(event: E, payload: IpcEventPayload<E>): void {
    this.bar?.send(event, payload)
  }

  private activate(): void {
    if (this.active) return
    const settings = this.deps.settings()
    try {
      const { workAreas, primary } = this.deps.displays()
      const position = resolveBarPosition(settings.barPosition, workAreas, primary)
      this.bar = this.deps.createBar(position, (moved) => this.deps.saveBarPosition(moved))
      this.note = this.deps.createNote()
    } catch (error) {
      // Sem barra a janela principal continua à vista: a gravação não pode ficar sem controles.
      this.log(`falha ao abrir a barra: ${messageOf(error)}`)
      this.closeWindows()
      this.restoreMain()
      return
    }
    this.active = true
    this.registerShortcut(settings.noteShortcut)
    this.hideMain()
  }

  private registerShortcut(accelerator: string): void {
    let ok = false
    try {
      ok = this.deps.shortcuts.register(accelerator, () => this.openEditor())
    } catch (error) {
      this.log(`atalho "${accelerator}" inválido: ${messageOf(error)}`)
    }
    if (ok) this.registered = accelerator
    else this.log(`atalho "${accelerator}" indisponível (em uso por outro app?)`)
    this.info = { shortcut: accelerator, shortcutRegistered: ok }
    this.bar?.send('floating:info', this.info)
  }

  private deactivate(): void {
    if (!this.active) return
    this.active = false
    if (this.registered) {
      try {
        this.deps.shortcuts.unregister(this.registered)
      } catch (error) {
        this.log(`erro ao liberar o atalho: ${messageOf(error)}`)
      }
      this.registered = null
    }
    this.draft = null
    this.previousForeground = null
    this.closeWindows()
    this.info = { ...this.info, shortcutRegistered: false }
  }

  private closeWindows(): void {
    this.note?.close()
    this.bar?.close()
    this.note = null
    this.bar = null
  }

  private canNote(): boolean {
    const phase = this.deps.recording.getState().phase
    return this.active && (phase === 'recording' || phase === 'paused')
  }

  /** Instante de "agora" na gravação, já com o recuo; `null` se não há gravação. */
  private currentOffset(): number | null {
    const state = this.deps.recording.getState()
    if (state.phase !== 'recording' && state.phase !== 'paused') return null
    return noteOffsetMs(state.clock, this.deps.now(), this.deps.settings().noteLeadSeconds)
  }

  /** Atalho global ou botão de Anotação: abre o campo sobre o app em uso. */
  openEditor(): void {
    if (!this.note || !this.bar || !this.canNote()) return
    const { workAreas, primary } = this.deps.displays()
    const bounds = this.bar.getBounds()
    const position = placeNoteWindow(
      bounds,
      NOTE_WINDOW_SIZE,
      pickWorkArea(bounds, workAreas, primary)
    )
    if (this.note.isVisible()) {
      // Já aberto (atalho de novo): só devolve o foco, sem perder o que foi digitado.
      this.note.showFocused(position)
      return
    }
    this.previousForeground = this.deps.foreground.capture()
    this.draft = { offsetMs: null }
    this.note.send('notes:opened', null)
    this.note.showFocused(position)
  }

  /** Primeira alteração do texto: fixa o Instante (colar sem digitar também conta). */
  beginNote(): void {
    if (!this.draft || this.draft.offsetMs !== null) return
    this.draft.offsetMs = this.currentOffset()
  }

  async saveNote(text: string): Promise<Result<null>> {
    const clean = normalizeNoteText(text)
    if (clean === '') return fail('invalid-request', 'A Anotação está vazia.')
    // Sem digitar antes (não deveria ocorrer): o Instante é o do salvamento.
    const offsetMs = this.draft?.offsetMs ?? this.currentOffset()
    if (offsetMs === null) return fail('not-recording', 'Não há gravação em andamento para anotar.')
    const result = await this.deps.recording.addNote(clean, offsetMs)
    if (!result.ok) return result
    this.closeEditor()
    this.bar?.send('notes:saved', { offsetMs: result.value.offsetMs })
    return { ok: true, value: null }
  }

  cancelNote(): void {
    this.closeEditor()
  }

  /**
   * Devolve o foco ao app que o tinha e esconde o campo. A ordem importa: enquanto o campo
   * ainda é a janela ativa, o Windows aceita a troca de foco; depois de escondido, poderia
   * recusar e só piscar o ícone na barra de tarefas.
   */
  private closeEditor(): void {
    this.draft = null
    const token = this.previousForeground
    this.previousForeground = null
    if (token !== null && token !== undefined) {
      try {
        this.deps.foreground.restore(token)
      } catch (error) {
        this.log(`não foi possível devolver o foco: ${messageOf(error)}`)
      }
    }
    this.note?.hide()
  }

  resizeBar(height: unknown): void {
    this.bar?.setHeight(clampBarHeight(height))
  }

  showMain(): void {
    this.deps.mainWindow.show()
  }
}
