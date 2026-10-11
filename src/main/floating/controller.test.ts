import { describe, expect, it } from 'vitest'
import { clockPause, clockResume, clockStart } from '@shared/clock'
import { BAR_SIZE, defaultBarPosition, type Point, type Rect } from '@shared/floating'
import type { IpcEventName, IpcEventPayload } from '@shared/ipc'
import type { MeetingNote } from '@shared/meeting'
import type { ActiveMeeting, RecordingState, Result } from '@shared/recording'
import { DEFAULT_SETTINGS } from '@shared/settings'
import { FloatingController, type FloatingDeps } from './controller'

const T0 = Date.UTC(2026, 9, 10, 17, 0, 0)
const primary: Rect = { x: 0, y: 0, width: 1920, height: 1040 }

const meeting: ActiveMeeting = {
  meetingId: 'm1',
  folder: 'C:\\m\\a',
  name: 'Reunião',
  source: { kind: 'window', name: 'Meet' },
  quality: '1080p',
  hasMic: true,
  hasSystemAudio: true,
  videoSize: { width: 1920, height: 1080 }
}

const recordingAt = (clock = clockStart(T0)): RecordingState => ({
  phase: 'recording',
  meeting,
  clock,
  warnings: []
})

interface Sent {
  target: 'bar' | 'note'
  event: string
  payload: unknown
}

function createHarness(overrides: Partial<FloatingDeps> = {}) {
  const log: string[] = []
  const sent: Sent[] = []
  const saved: Point[] = []
  const registered = new Map<string, () => void>()
  const added: { text: string; offsetMs: number }[] = []
  const state: { value: RecordingState } = { value: recordingAt() }
  const now = { value: T0 }
  const bar = { created: 0, closed: 0, positions: [] as Point[], heights: [] as number[] }
  const note = {
    created: 0,
    closed: 0,
    visible: false,
    shown: [] as Point[],
    hidden: 0
  }
  const restored: unknown[] = []
  const order: string[] = []
  const tray = { calls: [] as string[] }
  const main = { hidden: 0, shown: 0 }
  const shortcut = { accepts: true, throws: false }
  let onMoved: (position: Point) => void = () => undefined
  let addResult: Result<MeetingNote> | null = null

  const deps: FloatingDeps = {
    recording: {
      getState: () => state.value,
      addNote: (text, offsetMs) => {
        added.push({ text, offsetMs })
        return Promise.resolve(
          addResult ?? {
            ok: true,
            value: { id: 'n1', offsetMs, text, createdAt: new Date(now.value).toISOString() }
          }
        )
      }
    },
    settings: () => DEFAULT_SETTINGS,
    saveBarPosition: (position) => saved.push(position),
    displays: () => ({ workAreas: [primary], primary }),
    createBar: (position, moved) => {
      bar.created++
      bar.positions.push(position)
      onMoved = moved
      return {
        getBounds: () => ({ ...position, ...BAR_SIZE }),
        setHeight: (height) => bar.heights.push(height),
        send: <E extends IpcEventName>(event: E, payload: IpcEventPayload<E>) =>
          sent.push({ target: 'bar', event, payload }),
        close: () => bar.closed++
      }
    },
    createNote: () => {
      note.created++
      return {
        showFocused: (position) => {
          note.visible = true
          note.shown.push(position)
        },
        hide: () => {
          note.visible = false
          note.hidden++
          order.push('hide')
        },
        isVisible: () => note.visible,
        send: <E extends IpcEventName>(event: E, payload: IpcEventPayload<E>) =>
          sent.push({ target: 'note', event, payload }),
        close: () => note.closed++
      }
    },
    shortcuts: {
      register: (accelerator, callback) => {
        if (shortcut.throws) throw new Error('acelerador inválido')
        if (!shortcut.accepts) return false
        registered.set(accelerator, callback)
        return true
      },
      unregister: (accelerator) => registered.delete(accelerator)
    },
    foreground: {
      capture: () => 4242,
      restore: (token) => {
        restored.push(token)
        order.push('restore')
      }
    },
    mainWindow: {
      hide: () => main.hidden++,
      show: () => main.shown++
    },
    tray: {
      show: () => tray.calls.push('show'),
      hide: () => tray.calls.push('hide')
    },
    now: () => now.value,
    log: (message) => log.push(message),
    ...overrides
  }
  const controller = new FloatingController(deps)

  /** Muda o estado como o serviço faria e avisa o controlador. */
  const setState = (next: RecordingState): void => {
    state.value = next
    controller.onRecordingState(next)
  }

  return {
    controller,
    log,
    sent,
    saved,
    registered,
    added,
    state,
    now,
    bar,
    note,
    restored,
    order,
    tray,
    main,
    shortcut,
    setState,
    moveBar: (position: Point) => onMoved(position),
    failAdd: (result: Result<MeetingNote>) => (addResult = result)
  }
}

const SHORTCUT = DEFAULT_SETTINGS.noteShortcut

describe('FloatingController: ciclo da barra', () => {
  it('ao gravar: abre a barra no topo-centro, esconde a janela principal e registra o atalho', () => {
    const h = createHarness()
    h.setState({ phase: 'starting' })
    expect(h.bar.created).toBe(0) // a barra só aparece quando a gravação começa
    expect(h.main.hidden).toBe(1) // mas a principal já saiu, antes da captura

    h.setState(recordingAt())
    expect(h.bar.created).toBe(1)
    expect(h.note.created).toBe(1)
    expect(h.bar.positions[0]).toEqual(defaultBarPosition(primary))
    expect(h.main.hidden).toBe(1)
    expect(h.registered.has(SHORTCUT)).toBe(true)
    expect(h.controller.getInfo()).toEqual({ shortcut: SHORTCUT, shortcutRegistered: true })
  })

  it('a principal some no pedido de início, antes da captura, e volta se o início falhar', () => {
    const h = createHarness()
    h.setState({ phase: 'starting' })
    expect(h.main.hidden).toBe(1)
    expect(h.main.shown).toBe(0)

    // O serviço desiste (disco cheio, fonte sumiu, gravador falhou): volta a ocioso sem gravar.
    h.setState({ phase: 'idle', finished: null })
    expect(h.main.shown).toBe(1)
    expect(h.bar.created).toBe(0)
    expect(h.registered.size).toBe(0)

    // Nova tentativa que dá certo: esconde de novo, uma vez só, e a barra abre.
    h.setState({ phase: 'starting' })
    h.setState(recordingAt())
    expect(h.main.hidden).toBe(2)
    expect(h.bar.created).toBe(1)
  })

  it('início que vira gravação sem a barra abrir (erro) devolve a principal', () => {
    const h = createHarness({
      createBar: () => {
        throw new Error('sem janela')
      }
    })
    h.setState({ phase: 'starting' })
    expect(h.main.hidden).toBe(1)
    h.setState(recordingAt())
    expect(h.main.shown).toBe(1)
  })

  it('bandeja: aparece no pedido de início e some ao finalizar; início que falha também a remove', () => {
    const h = createHarness()
    h.setState({ phase: 'starting' })
    h.setState(recordingAt())
    h.setState({ phase: 'paused', meeting, clock: clockStart(T0), warnings: [] })
    h.setState(recordingAt())
    expect(h.tray.calls).toEqual(['show'])
    h.setState({ phase: 'finalizing', meeting, clock: clockStart(T0) })
    h.setState({ phase: 'idle', finished: null })
    expect(h.tray.calls).toEqual(['show', 'hide'])

    h.setState({ phase: 'starting' })
    h.setState({ phase: 'idle', finished: null })
    expect(h.tray.calls).toEqual(['show', 'hide', 'show', 'hide'])
  })

  it('erro ao criar o ícone da bandeja não atrapalha a gravação', () => {
    const h = createHarness({
      tray: {
        show: () => {
          throw new Error('sem bandeja')
        },
        hide: () => undefined
      }
    })
    h.setState({ phase: 'starting' })
    h.setState(recordingAt())
    expect(h.bar.created).toBe(1)
    expect(h.log.some((line) => line.includes('bandeja'))).toBe(true)
  })

  it('pausar e retomar não recriam nada', () => {
    const h = createHarness()
    h.setState(recordingAt())
    h.setState({
      phase: 'paused',
      meeting,
      clock: clockPause(clockStart(T0), T0 + 1000),
      warnings: []
    })
    h.setState(recordingAt())
    expect(h.bar.created).toBe(1)
    expect(h.main.hidden).toBe(1)
    expect(h.main.shown).toBe(0)
  })

  it('ao parar (finalizando): fecha barra e campo, libera o atalho e devolve a janela principal', () => {
    const h = createHarness()
    h.setState(recordingAt())
    h.setState({ phase: 'finalizing', meeting, clock: clockStart(T0) })
    expect(h.bar.closed).toBe(1)
    expect(h.note.closed).toBe(1)
    expect(h.registered.size).toBe(0)
    expect(h.main.shown).toBe(1)

    // O estado ocioso que vem depois não repete nada.
    h.setState({ phase: 'idle', finished: null })
    expect(h.main.shown).toBe(1)
    expect(h.bar.closed).toBe(1)
  })

  it('gravação que termina por outro motivo (volta direto a ocioso) também devolve a principal', () => {
    const h = createHarness()
    h.setState(recordingAt())
    h.setState({ phase: 'idle', finished: null })
    expect(h.bar.closed).toBe(1)
    expect(h.main.shown).toBe(1)
    expect(h.registered.size).toBe(0)
  })

  it('ocioso sem nunca ter gravado não mexe nas janelas', () => {
    const h = createHarness()
    h.setState({ phase: 'idle', finished: null })
    expect(h.main.shown).toBe(0)
    expect(h.main.hidden).toBe(0)
  })

  it('usa a última posição lembrada e grava a nova quando a barra é arrastada', () => {
    const h = createHarness({
      settings: () => ({ ...DEFAULT_SETTINGS, barPosition: { x: 400, y: 300 } })
    })
    h.setState(recordingAt())
    expect(h.bar.positions[0]).toEqual({ x: 400, y: 300 })
    h.moveBar({ x: 50, y: 60 })
    expect(h.saved).toEqual([{ x: 50, y: 60 }])
  })

  it('posição lembrada fora de qualquer monitor volta ao padrão', () => {
    const h = createHarness({
      settings: () => ({ ...DEFAULT_SETTINGS, barPosition: { x: 9000, y: 9000 } })
    })
    h.setState(recordingAt())
    expect(h.bar.positions[0]).toEqual(defaultBarPosition(primary))
  })

  it('se a barra não abre, a janela principal continua visível e a gravação segue', () => {
    const h = createHarness({
      createBar: () => {
        throw new Error('sem janela')
      }
    })
    h.setState(recordingAt())
    expect(h.main.hidden).toBe(0)
    expect(h.registered.size).toBe(0)
    expect(h.log.some((line) => line.includes('falha ao abrir a barra'))).toBe(true)
    // Parar depois não "devolve" uma janela que nunca saiu.
    h.setState({ phase: 'finalizing', meeting, clock: clockStart(T0) })
    expect(h.main.shown).toBe(0)
  })

  it('o botão da barra traz a janela principal de volta sem fechar a barra', () => {
    const h = createHarness()
    h.setState(recordingAt())
    h.controller.showMain()
    expect(h.main.shown).toBe(1)
    expect(h.bar.closed).toBe(0)
  })

  it('a barra recebe estado e níveis; a altura pedida é limitada', () => {
    const h = createHarness()
    h.setState(recordingAt())
    h.controller.forwardToBar('recording:level', { mic: 0.5, system: 0.1 })
    expect(h.sent.at(-1)).toEqual({
      target: 'bar',
      event: 'recording:level',
      payload: { mic: 0.5, system: 0.1 }
    })
    h.controller.resizeBar(9999)
    h.controller.resizeBar('lixo')
    expect(h.bar.heights).toEqual([140, BAR_SIZE.height])
  })
})

describe('FloatingController: atalho global', () => {
  it('atalho ocupado: avisa a barra e registra no log, sem quebrar', () => {
    const h = createHarness()
    h.shortcut.accepts = false
    h.setState(recordingAt())
    expect(h.controller.getInfo().shortcutRegistered).toBe(false)
    expect(h.sent).toContainEqual({
      target: 'bar',
      event: 'floating:info',
      payload: { shortcut: SHORTCUT, shortcutRegistered: false }
    })
    expect(h.log.some((line) => line.includes('indisponível'))).toBe(true)
    expect(h.main.hidden).toBe(1) // a barra funciona do mesmo jeito (botão de anotar)
    h.setState({ phase: 'idle', finished: null }) // e liberar não explode
    expect(h.main.shown).toBe(1)
  })

  it('acelerador inválido (exceção) também não quebra', () => {
    const h = createHarness()
    h.shortcut.throws = true
    h.setState(recordingAt())
    expect(h.controller.getInfo().shortcutRegistered).toBe(false)
    expect(h.log.some((line) => line.includes('inválido'))).toBe(true)
  })

  it('o atalho abre o campo de Anotação', () => {
    const h = createHarness()
    h.setState(recordingAt())
    h.registered.get(SHORTCUT)?.()
    expect(h.note.visible).toBe(true)
  })
})

describe('FloatingController: Anotações', () => {
  it('abre o campo abaixo da barra, avisa a UI e guarda o foco anterior', () => {
    const h = createHarness()
    h.setState(recordingAt())
    h.controller.openEditor()
    expect(h.note.visible).toBe(true)
    expect(h.note.shown).toHaveLength(1)
    expect(h.note.shown[0]?.y).toBeGreaterThan(h.bar.positions[0]?.y ?? 0)
    expect(h.sent).toContainEqual({ target: 'note', event: 'notes:opened', payload: null })
  })

  it('o Instante é o da primeira tecla menos 5 s, não o do salvamento', async () => {
    const h = createHarness()
    h.setState(recordingAt())
    h.now.value = T0 + 100_000
    h.controller.openEditor()
    h.now.value = T0 + 130_000 // abriu e ficou 30 s pensando
    h.controller.beginNote() // primeira tecla
    h.now.value = T0 + 160_000 // digitou por 30 s
    h.controller.beginNote() // teclas seguintes não mudam nada

    expect(await h.controller.saveNote('Combinar o prazo\ncom o time')).toEqual({
      ok: true,
      value: null
    })
    expect(h.added).toEqual([{ text: 'Combinar o prazo\ncom o time', offsetMs: 125_000 }])
  })

  it('perto do início o Instante não fica negativo', async () => {
    const h = createHarness()
    h.setState(recordingAt())
    h.now.value = T0 + 2_000
    h.controller.openEditor()
    h.controller.beginNote()
    await h.controller.saveNote('cedo')
    expect(h.added[0]?.offsetMs).toBe(0)
  })

  it('durante a pausa o Instante fica parado; depois de retomar volta a contar', async () => {
    const h = createHarness()
    h.setState(recordingAt())
    const paused = clockPause(clockStart(T0), T0 + 60_000)
    h.setState({ phase: 'paused', meeting, clock: paused, warnings: [] })

    h.now.value = T0 + 600_000
    h.controller.openEditor()
    h.controller.beginNote()
    await h.controller.saveNote('na pausa')
    expect(h.added[0]?.offsetMs).toBe(55_000)

    const resumed = clockResume(paused, T0 + 700_000)
    h.setState(recordingAt(resumed))
    h.now.value = T0 + 720_000 // 60 s + 20 s gravados
    h.controller.openEditor()
    h.controller.beginNote()
    await h.controller.saveNote('depois')
    expect(h.added[1]?.offsetMs).toBe(75_000)
  })

  it('colar sem digitar: a primeira alteração (beginNote) é que fixa o Instante', async () => {
    const h = createHarness()
    h.setState(recordingAt())
    h.now.value = T0 + 50_000
    h.controller.openEditor()
    h.now.value = T0 + 80_000
    h.controller.beginNote() // o evento de colagem
    h.now.value = T0 + 90_000
    await h.controller.saveNote('colado')
    expect(h.added[0]?.offsetMs).toBe(75_000)
  })

  it('salvar fecha o campo, devolve o foco e mostra o aviso na barra', async () => {
    const h = createHarness()
    h.setState(recordingAt())
    h.now.value = T0 + 30_000
    h.controller.openEditor()
    h.controller.beginNote()
    await h.controller.saveNote('ok')
    expect(h.note.visible).toBe(false)
    expect(h.restored).toEqual([4242])
    expect(h.order).toEqual(['restore', 'hide']) // foco volta antes de esconder o campo
    expect(h.sent).toContainEqual({
      target: 'bar',
      event: 'notes:saved',
      payload: { offsetMs: 25_000 }
    })
  })

  it('texto vazio não salva e mantém o campo aberto', async () => {
    const h = createHarness()
    h.setState(recordingAt())
    h.controller.openEditor()
    const result = await h.controller.saveNote('  \n ')
    expect(result.ok).toBe(false)
    expect(h.added).toEqual([])
    expect(h.note.visible).toBe(true)
  })

  it('cancelar fecha sem salvar e devolve o foco', () => {
    const h = createHarness()
    h.setState(recordingAt())
    h.controller.openEditor()
    h.controller.cancelNote()
    expect(h.note.visible).toBe(false)
    expect(h.added).toEqual([])
    expect(h.restored).toEqual([4242])
    // Cancelar de novo (o campo perde o foco depois de esconder) não devolve o foco outra vez.
    h.controller.cancelNote()
    expect(h.restored).toEqual([4242])
  })

  it('abrir de novo com o campo aberto só refoca, sem perder o Instante já fixado', async () => {
    const h = createHarness()
    h.setState(recordingAt())
    h.now.value = T0 + 40_000
    h.controller.openEditor()
    h.controller.beginNote()
    h.now.value = T0 + 70_000
    h.controller.openEditor()
    expect(h.note.shown).toHaveLength(2)
    expect(h.sent.filter((item) => item.event === 'notes:opened')).toHaveLength(1)
    await h.controller.saveNote('x')
    expect(h.added[0]?.offsetMs).toBe(35_000)
  })

  it('se o serviço recusa salvar, o campo continua aberto com o erro', async () => {
    const h = createHarness()
    h.setState(recordingAt())
    h.controller.openEditor()
    h.failAdd({ ok: false, error: { code: 'unknown', message: 'disco cheio' } })
    const result = await h.controller.saveNote('texto')
    expect(result).toEqual({ ok: false, error: { code: 'unknown', message: 'disco cheio' } })
    expect(h.note.visible).toBe(true)
  })

  it('sem gravação não abre o campo nem salva', async () => {
    const h = createHarness()
    h.state.value = { phase: 'idle', finished: null }
    h.controller.openEditor()
    expect(h.note.created).toBe(0)
    h.setState(recordingAt())
    h.state.value = { phase: 'idle', finished: null }
    const result = await h.controller.saveNote('tarde demais')
    expect(result.ok).toBe(false)
    expect(h.added).toEqual([])
  })

  it('parar com o campo aberto fecha tudo', () => {
    const h = createHarness()
    h.setState(recordingAt())
    h.controller.openEditor()
    h.setState({ phase: 'finalizing', meeting, clock: clockStart(T0) })
    expect(h.note.closed).toBe(1)
    expect(h.main.shown).toBe(1)
  })
})
