/**
 * Modo de automação, SÓ para desenvolvimento (`!app.isPackaged` e `CLEARMEET_AUTOMATION`):
 * executa um cenário de gravação sem ninguém clicando, para a verificação de ponta a ponta
 * (resize/minimização da janela gravada, pausa, queda do processo, recuperação…).
 * Não é carregado no app empacotado.
 *
 * `CLEARMEET_AUTOMATION` aponta para um JSON `Scenario`. O resultado vai para `resultFile`.
 */
import { readFile, writeFile } from 'node:fs/promises'
import os from 'node:os'
import { app, BrowserWindow, desktopCapturer, screen } from 'electron'
import type { QualityPreset } from '@shared/capture'
import type { RecorderSession, RecordingService, RecorderSink } from '../recording/service'
import type { RecoveryService } from '../recording/recovery-service'
import type { StartRecordingRequest } from '@shared/recording'

type Action =
  | { at: number; do: 'resize'; width: number; height: number }
  | { at: number; do: 'minimize' | 'restore' | 'close-source' | 'hide-main' | 'show-main' }
  | { at: number; do: 'pause' | 'resume' | 'stop' }

interface Scenario {
  name: string
  /** Janela sintética própria, a tela principal (cuidado: captura a tela real) ou só áudio. */
  source: 'window' | 'screen' | 'none'
  quality: QualityPreset
  /** Microfone sintético do Chromium (exige `CLEARMEET_FAKE_MEDIA=1`, que também falsifica a captura de tela). */
  mic: boolean
  seconds: number
  actions: Action[]
  /** Encerra o processo de forma abrupta (SIGKILL) neste segundo, para testar a recuperação. */
  crashAt?: number
  /** Só roda a recuperação e escreve o relatório (usado após um crash). */
  recoveryOnly?: boolean
  /** Só mede o limitador do mix na janela de gravação. */
  limiterCheck?: boolean
  /** Dirige a UI de verdade (cliques) e salva capturas de tela da janela principal nesta pasta. */
  uiTour?: { screenshotDir: string }
  /** Mede o uso de CPU dos processos do app durante a gravação (resultado em `metrics`). */
  metrics?: boolean
  /** Conteúdo da janela sintética: animado (padrão) ou estático (nada muda na tela). */
  workload?: 'animated' | 'static'
  /** Tamanho inicial da janela sintética. */
  window?: { width: number; height: number }
  resultFile: string
}

export interface AutomationDeps {
  service: RecordingService
  recovery: RecoveryService
  createRecorder(sink: RecorderSink): Promise<RecorderSession>
  getMainWindow(): BrowserWindow | null
  meetingsDir(): string
  log(message: string): void
}

const WORKLOAD_HTML = `<!doctype html><meta charset="utf-8"><title>ALVO-SINTETICO ClearMeet</title>
<body style="margin:0;background:#12202e;color:#fff;font:600 26px Consolas,monospace;overflow:hidden">
<div id="clock" style="position:absolute;left:30px;top:20px;font-size:54px"></div>
<div id="text" style="position:absolute;left:30px;top:120px;line-height:1.5;font-size:24px"></div>
<canvas id="tile" width="360" height="220" style="position:absolute;right:30px;top:20px"></canvas>
<div id="flash" style="position:absolute;left:0;bottom:0;width:100%;height:50px;background:#000"></div>
<script>
const start = performance.now()
const clock = document.getElementById('clock')
const text = document.getElementById('text')
const tile = document.getElementById('tile').getContext('2d')
const flash = document.getElementById('flash')
const lines = ['Pauta: revisão do trimestre', 'Decisão: adiar o lançamento', 'Responsável: Ana (contrato)', 'Prazo: sexta-feira 14h']
let audio
function beep() {
  audio ??= new AudioContext()
  const osc = audio.createOscillator()
  const gain = audio.createGain()
  osc.frequency.value = 1337
  gain.gain.value = 0.4
  osc.connect(gain).connect(audio.destination)
  osc.start()
  osc.stop(audio.currentTime + 0.25)
  flash.style.background = '#fff'
  setTimeout(() => (flash.style.background = '#000'), 250)
}
setInterval(beep, 5000)
function draw() {
  const s = (performance.now() - start) / 1000
  clock.textContent = 'T+' + s.toFixed(1) + 's'
  text.textContent = lines.slice(0, 1 + (Math.floor(s / 4) % lines.length)).join('\\n')
  text.style.whiteSpace = 'pre'
  tile.fillStyle = '#223'
  tile.fillRect(0, 0, 360, 220)
  tile.fillStyle = '#f90'
  const x = 20 + ((s * 120) % 300)
  tile.fillRect(x, 80, 40, 60)
  requestAnimationFrame(draw)
}
draw()
</script>`

const STATIC_HTML = `<!doctype html><meta charset="utf-8"><title>ALVO-SINTETICO ClearMeet</title>
<body style="margin:0;background:#ffffff;color:#222;font:24px Consolas,monospace;padding:30px;line-height:1.5">
<h2>Planilha de custos (conteudo estatico)</h2>
<pre>Item            Q1      Q2      Q3      Q4
Licencas        1200    1300    1250    1400
Infra           800     820     900     950
Pessoas         5400    5400    5600    5800
Total           7400    7520    7750    8150</pre>
</body>`

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

function createTargetWindow(
  size: { width: number; height: number },
  workload: 'animated' | 'static' = 'animated'
): Promise<BrowserWindow> {
  const window = new BrowserWindow({
    width: size.width,
    height: size.height,
    x: 40,
    y: 40,
    useContentSize: true,
    show: false,
    title: 'ALVO-SINTETICO ClearMeet',
    webPreferences: {
      sandbox: true,
      backgroundThrottling: false,
      autoplayPolicy: 'no-user-gesture-required'
    }
  })
  window.setMenuBarVisibility(false)
  return new Promise((resolve) => {
    window.webContents.once('did-finish-load', () => {
      window.setTitle('ALVO-SINTETICO ClearMeet')
      window.show()
      resolve(window)
    })
    void window.loadURL(
      `data:text/html;charset=utf-8,${encodeURIComponent(workload === 'static' ? STATIC_HTML : WORKLOAD_HTML)}`
    )
  })
}

async function primaryScreenSource(): Promise<{ id: string; name: string }> {
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: 0, height: 0 }
  })
  const primary = String(screen.getPrimaryDisplay().id)
  const source = sources.find((candidate) => candidate.display_id === primary) ?? sources[0]
  if (!source) throw new Error('nenhuma tela encontrada')
  return { id: source.id, name: source.name }
}

export async function runAutomation(deps: AutomationDeps): Promise<void> {
  const path = process.env['CLEARMEET_AUTOMATION']
  if (!path) return
  const scenario = JSON.parse(await readFile(path, 'utf8')) as Scenario
  const started = Date.now()
  const timeline: { t: number; event: string; detail?: unknown }[] = []
  const mark = (event: string, detail?: unknown): void => {
    timeline.push({ t: +((Date.now() - started) / 1000).toFixed(2), event, detail })
    deps.log(`[automation] ${event}${detail ? ' ' + JSON.stringify(detail) : ''}`)
  }
  const write = (extra: Record<string, unknown>): Promise<void> =>
    writeFile(scenario.resultFile, JSON.stringify({ scenario, timeline, ...extra }, null, 2))

  try {
    if (scenario.recoveryOnly) {
      const report = await deps.recovery.run()
      await write({ report })
      app.exit(0)
      return
    }

    if (scenario.limiterCheck) {
      const recorder = await deps.createRecorder({
        chunk: () => Promise.resolve(),
        event: () => undefined,
        crashed: () => undefined
      })
      const limiter = await recorder.send({ name: 'limiter-check' })
      recorder.destroy()
      await write({ limiter })
      app.exit(0)
      return
    }

    if (scenario.uiTour) {
      await runUiTour(deps, scenario.uiTour.screenshotDir, mark)
      await write({})
      app.exit(0)
      return
    }

    let target: BrowserWindow | null = null
    let request: StartRecordingRequest
    if (scenario.source === 'window') {
      target = await createTargetWindow(
        scenario.window ?? { width: 1280, height: 720 },
        scenario.workload
      )
      await sleep(1000)
      request = {
        source: { kind: 'window', id: target.getMediaSourceId(), name: 'ALVO-SINTETICO ClearMeet' },
        mic: scenario.mic ? { deviceId: 'default', label: '' } : null,
        quality: scenario.quality
      }
    } else if (scenario.source === 'screen') {
      const screenSource = await primaryScreenSource()
      request = {
        source: { kind: 'screen', ...screenSource },
        mic: scenario.mic ? { deviceId: 'default', label: '' } : null,
        quality: scenario.quality
      }
    } else {
      request = {
        source: { kind: 'none' },
        mic: scenario.mic ? { deviceId: 'default', label: '' } : null,
        quality: scenario.quality
      }
      // Janela sintética tocando bipes para haver áudio do sistema.
      target = await createTargetWindow({ width: 640, height: 360 })
    }

    // Registra cada mudança de estado/avisos.
    let lastSignature = ''
    const poll = setInterval(() => {
      const state = service().getState()
      const warnings = 'warnings' in state ? state.warnings : []
      const signature = `${state.phase}|${warnings.join(',')}`
      if (signature !== lastSignature) {
        lastSignature = signature
        mark('state', { phase: state.phase, warnings })
      }
    }, 200)
    function service(): RecordingService {
      return deps.service
    }

    const sampler = scenario.metrics ? startMetrics(deps, target) : null
    const result = await deps.service.start(request)
    mark('start', result)
    if (!result.ok) {
      clearInterval(poll)
      await write({ startResult: result })
      app.exit(1)
      return
    }
    const begin = Date.now()
    const state = deps.service.getState()
    if (state.phase === 'recording') {
      mark('active', { folder: state.meeting.folder, videoSize: state.meeting.videoSize })
    }

    if (scenario.crashAt !== undefined) {
      setTimeout(() => {
        mark('crash')
        void write({ crashed: true }).finally(() => process.kill(process.pid, 'SIGKILL'))
      }, scenario.crashAt * 1000)
    }

    const run = async (action: Action): Promise<void> => {
      mark('action', action)
      switch (action.do) {
        case 'resize':
          target?.setContentSize(action.width, action.height)
          break
        case 'minimize':
          target?.minimize()
          break
        case 'restore':
          target?.restore()
          break
        case 'close-source':
          target?.close()
          break
        case 'hide-main':
          deps.getMainWindow()?.hide()
          break
        case 'show-main':
          deps.getMainWindow()?.showInactive()
          break
        case 'pause':
          mark('pause', await deps.service.pause())
          break
        case 'resume':
          mark('resume', await deps.service.resume())
          break
        case 'stop':
          break
      }
    }
    for (const action of [...scenario.actions].sort((a, b) => a.at - b.at)) {
      await sleep(Math.max(0, action.at * 1000 - (Date.now() - begin)))
      if (deps.service.getState().phase === 'idle') break
      await run(action)
    }
    // Espera o fim previsto, ou o fim antecipado (fonte fechada, erro…).
    while (
      Date.now() - begin < scenario.seconds * 1000 &&
      deps.service.getState().phase !== 'idle'
    ) {
      await sleep(200)
    }
    const stopped =
      deps.service.getState().phase === 'idle' ? null : await deps.service.stop('user')
    mark('stopped', stopped ? { status: stopped.ok } : 'já encerrada')
    clearInterval(poll)
    const finalState = deps.service.getState()
    await write({
      begin,
      metrics: sampler?.result() ?? null,
      finished: finalState.phase === 'idle' ? finalState.finished : null
    })
    target?.destroy()
    app.exit(0)
  } catch (error) {
    mark('erro', String(error))
    await write({ error: String(error) }).catch(() => undefined)
    app.exit(1)
  }
}

/** Máscara de privacidade: esconde miniaturas e nomes de telas/janelas que não são o alvo sintético. */
const MASK_JS = `(() => {
  for (const card of document.querySelectorAll('button[role="radio"]')) {
    const text = card.textContent || ''
    if (text.includes('ALVO-SINTETICO') || text.includes('só áudio')) continue
    card.querySelectorAll('img').forEach((img) => (img.style.visibility = 'hidden'))
    card.querySelectorAll('div.truncate').forEach((el) => (el.textContent = '(oculto)'))
  }
})()`

const clickByText = (selector: string, text: string): string => `(() => {
  const el = [...document.querySelectorAll(${JSON.stringify(selector)})].find((e) => (e.textContent || '').includes(${JSON.stringify(text)}))
  if (!el) return false
  el.click()
  return true
})()`

async function runUiTour(
  deps: AutomationDeps,
  dir: string,
  mark: (event: string, detail?: unknown) => void
): Promise<void> {
  const { mkdir } = await import('node:fs/promises')
  await mkdir(dir, { recursive: true })
  const window = deps.getMainWindow()
  if (!window) throw new Error('janela principal ausente')
  const js = <T>(code: string): Promise<T> =>
    window.webContents.executeJavaScript(code, true) as Promise<T>
  const shot = async (name: string, mask = true): Promise<void> => {
    if (mask) await js(MASK_JS)
    await sleep(250)
    const image = await window.webContents.capturePage()
    await writeFile(`${dir}/${name}.png`, image.toPNG())
    mark('screenshot', name)
  }
  const waitFor = async (code: string, timeoutMs = 20_000): Promise<void> => {
    const until = Date.now() + timeoutMs
    while (Date.now() < until) {
      if (await js<boolean>(code)) return
      await sleep(250)
    }
    throw new Error(`tempo esgotado: ${code.slice(0, 80)}`)
  }

  const target = await createTargetWindow({ width: 1000, height: 600 })
  await sleep(500)
  window.focus()
  await waitFor(`document.querySelectorAll('button[role="radio"]').length > 1`)
  await waitFor(`!!document.body.textContent.includes('ALVO-SINTETICO')`)
  await sleep(1500)
  await shot('1-preparar')

  await js(clickByText('button[role="radio"]', 'ALVO-SINTETICO'))
  await sleep(300)
  await shot('2-janela-selecionada')

  await js(clickByText('button', 'Iniciar gravação'))
  await waitFor(`!!document.querySelector('[role="timer"]')`)
  await sleep(5000)
  await shot('3-gravando')

  await js(clickByText('button', 'Pausar'))
  await sleep(1500)
  await shot('4-pausada')
  await js(clickByText('button', 'Retomar'))
  await sleep(500)

  target.minimize()
  await waitFor(`document.body.textContent.includes('minimizada')`, 15_000)
  await shot('5-aviso-minimizada')
  target.restore()
  await sleep(2500)

  await js(clickByText('button', 'Parar e salvar'))
  await waitFor(`!!document.getElementById('meeting-name')`, 60_000)
  await shot('6-nome-da-reuniao')

  await js(`(() => {
    const input = document.getElementById('meeting-name')
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    setter.call(input, 'Revisão: planejamento Q4?')
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })()`)
  await sleep(300)
  await js(clickByText('button', 'Concluir'))
  await waitFor(`document.body.textContent.includes('Iniciar gravação')`, 15_000)
  await sleep(1500)
  await shot('7-depois')

  target.destroy()
}

interface MetricSample {
  at: number
  cpu: Map<number, { type: string; seconds: number }>
  system: { idle: number; total: number }
}

function takeSample(): MetricSample {
  const cpu = new Map<number, { type: string; seconds: number }>()
  for (const metric of app.getAppMetrics()) {
    cpu.set(metric.pid, { type: metric.type, seconds: metric.cpu.cumulativeCPUUsage ?? 0 })
  }
  let idle = 0
  let total = 0
  for (const core of os.cpus()) {
    for (const value of Object.values(core.times)) total += value
    idle += core.times.idle
  }
  return { at: Date.now(), cpu, system: { idle, total } }
}

/**
 * Mede a CPU por processo (tempo de CPU acumulado / tempo decorrido, 100% = 1 núcleo lógico),
 * ignorando os primeiros 10 s (aquecimento do codificador). Mesmo método do spike da Fase 0.
 * `target` é o processo da janela sintética (a carga de trabalho, que não é custo do app).
 */
function startMetrics(
  deps: AutomationDeps,
  target: BrowserWindow | null
): { result: () => Record<string, unknown> } {
  let first: MetricSample | null = null
  let last: MetricSample | null = null
  const timer = setInterval(() => {
    if (deps.service.getState().phase !== 'recording') return
    const sample = takeSample()
    if (!first && Date.now() - startedAt > 10_000) first = sample
    last = sample
  }, 1000)
  const startedAt = Date.now()
  return {
    result() {
      clearInterval(timer)
      if (!first || !last) return { error: 'amostras insuficientes' }
      const spanSec = (last.at - first.at) / 1000
      const mainPid = deps.getMainWindow()?.webContents.getOSProcessId()
      const targetPid = target?.webContents.getOSProcessId()
      const byLabel: Record<string, number> = {}
      for (const [pid, now] of last.cpu) {
        const before = first.cpu.get(pid)
        if (!before) continue
        const label =
          pid === targetPid
            ? 'alvo-sintetico(carga, nao conta)'
            : pid === mainPid
              ? 'ui-principal'
              : now.type === 'Tab'
                ? 'renderer-gravador'
                : now.type
        byLabel[label] = (byLabel[label] ?? 0) + (100 * (now.seconds - before.seconds)) / spanSec
      }
      const appTotal = Object.entries(byLabel)
        .filter(([label]) => !label.startsWith('alvo-sintetico'))
        .reduce((sum, [, value]) => sum + value, 0)
      const cores = os.cpus().length
      const systemPct =
        100 *
        (1 - (last.system.idle - first.system.idle) / (last.system.total - first.system.total))
      return {
        spanSec: +spanSec.toFixed(1),
        pctOfOneCoreByProcess: Object.fromEntries(
          Object.entries(byLabel).map(([label, value]) => [label, +value.toFixed(1)])
        ),
        clearMeetPctOfOneCore: +appTotal.toFixed(1),
        clearMeetPctOfTotalCpu: +(appTotal / cores).toFixed(2),
        logicalCores: cores,
        systemCpuPctTotal: +systemPct.toFixed(1)
      }
    }
  }
}
