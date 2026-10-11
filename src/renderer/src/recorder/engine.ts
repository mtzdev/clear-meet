import {
  AUDIO_BITS_PER_SECOND,
  CAPTURE_FPS,
  CHUNK_INTERVAL_MS,
  captureMaxSize,
  resolveCanvasSize,
  videoBitrate,
  type Size
} from '@shared/capture'
import type {
  RecorderBridge,
  RecorderChunkKind,
  RecorderStarted,
  RecorderStartParams
} from '@shared/recorder'
import type { MicSelection } from '@shared/recording'
import { FrameStallDetector } from '@shared/stall-detector'
import { VideoEncoderWatchdog } from '@shared/video-watchdog'
import { createMixChain } from './mix'
import { peekSourceSize, startVideoPipeline, type VideoPipeline } from './pipeline'

const VIDEO_MIMES = [
  'video/mp4;codecs=avc1,opus',
  'video/mp4;codecs=avc1.42E01E,opus',
  'video/mp4;codecs=avc1.4D401F,opus'
]
const AUDIO_MIMES = ['audio/webm;codecs=opus']

/** Os níveis são medidos a cada 100 ms e enviados a ~5 Hz (pico das duas medidas). */
const LEVEL_INTERVAL_MS = 100
const STALL_CHECK_INTERVAL_MS = 500
const WATCHDOG_CHECK_INTERVAL_MS = 2000

function pickMime(candidates: string[]): string | null {
  return candidates.find((mime) => MediaRecorder.isTypeSupported(mime)) ?? null
}

/** Mensagem em português para uma falha de `getUserMedia`/`getDisplayMedia`. */
function describeMediaError(error: unknown): string {
  const name = error instanceof DOMException || error instanceof Error ? error.name : ''
  switch (name) {
    case 'NotAllowedError':
      return 'permissão negada'
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'dispositivo não encontrado'
    case 'NotReadableError':
      return 'dispositivo em uso por outro programa'
    default:
      return error instanceof Error ? error.message : String(error)
  }
}

/** Pico (0 a 1) do último bloco de amostras de um `AnalyserNode`. */
function createPeakReader(analyser: AnalyserNode): () => number {
  const buffer = new Float32Array(analyser.fftSize)
  return () => {
    analyser.getFloatTimeDomainData(buffer)
    let peak = 0
    for (const sample of buffer) peak = Math.max(peak, Math.abs(sample))
    return Math.min(1, peak)
  }
}

/** Gravador com os pedaços entregues ao main na ordem, um a um. */
class ChunkedRecorder {
  readonly recorder: MediaRecorder
  private chain: Promise<void> = Promise.resolve()
  startedAt = 0
  private readonly started: Promise<void>
  private readonly stopped: Promise<void>

  constructor(
    stream: MediaStream,
    options: MediaRecorderOptions,
    private readonly kind: RecorderChunkKind,
    private readonly bridge: RecorderBridge,
    private readonly onError: (message: string) => void,
    private readonly onData: () => void = () => undefined
  ) {
    this.recorder = new MediaRecorder(stream, options)
    this.recorder.ondataavailable = (event) => {
      if (event.data.size === 0) return
      this.onData()
      // Cada pedaço vai ao disco (via main) antes do próximo e não fica na memória deste processo.
      this.chain = this.chain.then(async () => {
        try {
          await this.bridge.sendChunk(this.kind, await event.data.arrayBuffer())
        } catch (error) {
          this.onError(`Falha ao entregar um pedaço de ${this.kind}: ${String(error)}`)
        }
      })
    }
    this.recorder.onerror = (event) => {
      const detail = (event as Event & { error?: DOMException }).error
      this.onError(`Erro no gravador de ${this.kind}: ${detail?.message ?? 'desconhecido'}`)
    }
    this.started = new Promise((resolve) => {
      this.recorder.onstart = () => {
        this.startedAt = Date.now()
        resolve()
      }
    })
    this.stopped = new Promise((resolve) => {
      this.recorder.onstop = () => void this.chain.then(resolve)
    })
  }

  async start(): Promise<void> {
    this.recorder.start(CHUNK_INTERVAL_MS)
    await this.started
  }

  async stop(): Promise<void> {
    if (this.recorder.state !== 'inactive') this.recorder.stop()
    await this.stopped
  }
}

interface Capture {
  display: MediaStream
  mic: MediaStream | null
  context: AudioContext
  video: VideoPipeline | null
  audioRecorder: ChunkedRecorder
  videoRecorder: ChunkedRecorder | null
  timers: number[]
  detector: FrameStallDetector | null
  watchdog: VideoEncoderWatchdog | null
}

/**
 * Captura e gravação, dentro da janela oculta: tela/janela (opcional) + áudio do sistema +
 * microfone, mixados com limitador, gravados em dois `MediaRecorder` paralelos (Vídeo
 * H.264+Opus em MP4 e Áudio da reunião em Opus/WebM) em pedaços de ~3 s.
 */
export class RecorderEngine {
  private capture: Capture | null = null

  constructor(private readonly bridge: RecorderBridge) {}

  private report(message: string): void {
    this.bridge.sendEvent({ type: 'error', message })
  }

  async start(params: RecorderStartParams): Promise<RecorderStarted> {
    if (this.capture) throw new Error('Já existe uma captura em andamento')

    const videoMime = params.hasVideo ? pickMime(VIDEO_MIMES) : null
    if (params.hasVideo && !videoMime) {
      throw new Error('Este computador não consegue gravar vídeo H.264 em MP4.')
    }
    const audioMime = pickMime(AUDIO_MIMES)
    if (!audioMime) throw new Error('Este computador não consegue gravar áudio Opus.')

    // 1) Tela/janela + áudio do sistema. O main já escolheu a fonte para este pedido.
    const max = captureMaxSize(params.preset)
    let display: MediaStream
    try {
      display = await navigator.mediaDevices.getDisplayMedia({
        video: params.hasVideo
          ? {
              frameRate: { ideal: CAPTURE_FPS, max: CAPTURE_FPS },
              width: { max: max.width },
              height: { max: max.height }
            }
          : true,
        audio: true
      })
    } catch (error) {
      throw new Error(`Não foi possível capturar a tela: ${describeMediaError(error)}.`, {
        cause: error
      })
    }

    const loopback = display.getAudioTracks()
    const sourceTrack = display.getVideoTracks()[0]
    if (!params.hasVideo && sourceTrack) {
      // Só áudio: o vídeo foi pedido apenas para obter o loopback.
      sourceTrack.stop()
      display.removeTrack(sourceTrack)
    }

    let sourceSize: Size | null = null
    if (params.hasVideo) {
      if (!sourceTrack) throw new Error('A captura não entregou vídeo.')
      const settings = sourceTrack.getSettings()
      sourceSize = { width: settings.width ?? 0, height: settings.height ?? 0 }
      if (sourceSize.width > max.width || sourceSize.height > max.height) {
        // A captura veio maior que o pedido: força a redução na origem.
        await sourceTrack
          .applyConstraints({
            width: { max: max.width },
            height: { max: max.height },
            frameRate: { max: CAPTURE_FPS }
          })
          .catch(() => undefined)
      }
    }

    // 2) Microfone (falha não impede a gravação: ela segue só com o áudio do sistema).
    const { stream: mic, problem: micProblem } = params.mic
      ? await this.openMic(params.mic)
      : { stream: null, problem: null }

    // 3) Mix mono com limitador.
    const context = new AudioContext({ sampleRate: 48_000 })
    await context.resume()
    const destination = context.createMediaStreamDestination()
    destination.channelCount = 1
    destination.channelCountMode = 'explicit'
    destination.channelInterpretation = 'speakers'
    const chain = createMixChain(context)
    chain.output.connect(destination)

    const readers: { mic: () => number; system: () => number } = {
      mic: () => 0,
      system: () => 0
    }
    const connectSource = (stream: MediaStream, key: 'mic' | 'system'): void => {
      const node = context.createMediaStreamSource(stream)
      node.connect(chain.input)
      const analyser = context.createAnalyser()
      analyser.fftSize = 1024
      node.connect(analyser)
      readers[key] = createPeakReader(analyser)
    }
    if (mic) connectSource(mic, 'mic')
    if (loopback.length > 0) connectSource(new MediaStream(loopback), 'system')
    if (!mic && loopback.length === 0) {
      // Sem nenhuma fonte de áudio: mantém uma trilha silenciosa para o gravador não falhar.
      const silent = context.createConstantSource()
      silent.offset.value = 0
      silent.connect(chain.input)
      silent.start()
    }
    const mixTrack = destination.stream.getAudioTracks()[0]
    if (!mixTrack) throw new Error('O mix de áudio não gerou trilha')

    // 4) Vídeo: canvas de tamanho fixo. Na resolução nativa o tamanho vem do primeiro quadro real.
    if (params.hasVideo && sourceTrack && params.preset === 'native') {
      sourceSize = (await peekSourceSize(sourceTrack)) ?? sourceSize
    }
    const canvas = resolveCanvasSize(params.preset, sourceSize)
    const detector =
      params.hasVideo && params.watchStalls ? new FrameStallDetector(performance.now()) : null
    const watchdog = params.hasVideo ? new VideoEncoderWatchdog(performance.now()) : null
    let video: VideoPipeline | null = null
    if (params.hasVideo && sourceTrack) {
      video = startVideoPipeline({
        source: sourceTrack,
        canvas,
        fps: CAPTURE_FPS,
        onFrame: () => detector?.onFrame(performance.now()),
        onFed: () => watchdog?.onFeed(performance.now()),
        onError: (message) => this.report(message)
      })
      sourceTrack.addEventListener('ended', () => this.bridge.sendEvent({ type: 'source-ended' }))
    }

    // 5) Gravadores.
    const videoBits = videoBitrate(params.preset, canvas, params.compaction)
    // O de vídeo é construído e iniciado primeiro, como no spike da Fase 0.
    const videoRecorder =
      video && videoMime
        ? new ChunkedRecorder(
            new MediaStream([video.track, mixTrack.clone()]),
            {
              mimeType: videoMime,
              videoBitsPerSecond: videoBits,
              audioBitsPerSecond: AUDIO_BITS_PER_SECOND
            },
            'video',
            this.bridge,
            (message) => this.report(message),
            () => watchdog?.onData(performance.now())
          )
        : null

    const audioRecorder = new ChunkedRecorder(
      new MediaStream([mixTrack.clone()]),
      { mimeType: audioMime, audioBitsPerSecond: AUDIO_BITS_PER_SECOND },
      'audio',
      this.bridge,
      (message) => this.report(message)
    )

    // Níveis medidos a 10 Hz e enviados a ~5 Hz (a cada duas medidas, com o pico das duas).
    let tick = 0
    let heldMic = 0
    let heldSystem = 0
    const timers: number[] = [
      window.setInterval(() => {
        heldMic = Math.max(heldMic, readers.mic())
        heldSystem = Math.max(heldSystem, readers.system())
        if (++tick % 2 !== 0) return
        this.bridge.sendEvent({ type: 'levels', mic: heldMic, system: heldSystem })
        heldMic = 0
        heldSystem = 0
      }, LEVEL_INTERVAL_MS)
    ]
    if (detector) {
      timers.push(
        window.setInterval(() => {
          const stalled = detector.check(performance.now())
          if (stalled !== null) this.bridge.sendEvent({ type: 'frames-stalled', stalled })
        }, STALL_CHECK_INTERVAL_MS)
      )
    }
    if (watchdog) {
      timers.push(
        window.setInterval(() => {
          const stalled = watchdog.check(performance.now())
          if (stalled !== null) this.bridge.sendEvent({ type: 'video-stalled', stalled })
        }, WATCHDOG_CHECK_INTERVAL_MS)
      )
    }

    this.capture = {
      display,
      mic,
      context,
      video,
      audioRecorder,
      videoRecorder,
      timers,
      detector,
      watchdog
    }

    // Os dois gravadores partem juntos, o de vídeo primeiro (como no spike: com o de áudio
    // primeiro, o codificador de vídeo travava com frequência); o Instante zero é o `onstart`
    // do de áudio.
    await Promise.all([videoRecorder?.start(), audioRecorder.start()])

    return {
      startedAt: audioRecorder.startedAt,
      video: videoRecorder
        ? {
            width: canvas.width,
            height: canvas.height,
            fps: CAPTURE_FPS,
            mimeType: videoMime ?? '',
            bitsPerSecond: videoBits,
            sourceWidth: sourceSize?.width ?? 0,
            sourceHeight: sourceSize?.height ?? 0
          }
        : null,
      audioMimeType: audioMime,
      hasMic: mic !== null,
      hasSystemAudio: loopback.length > 0,
      micProblem
    }
  }

  /** Abre o microfone pelo `deviceId`; se ele mudou de origem para origem, procura pelo rótulo. */
  private async openMic(
    selection: MicSelection
  ): Promise<{ stream: MediaStream | null; problem: string | null }> {
    // Sem processamento: eco/ruído/ganho automático alteram a voz e brigam com o loopback.
    const base = { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
    const attempts: (string | null)[] = [selection.deviceId]
    try {
      const devices = await navigator.mediaDevices.enumerateDevices()
      const byLabel = devices.find(
        (device) =>
          device.kind === 'audioinput' &&
          selection.label !== '' &&
          device.label === selection.label &&
          device.deviceId !== selection.deviceId
      )
      if (byLabel) attempts.push(byLabel.deviceId)
    } catch {
      // segue com o que tem
    }
    attempts.push(null) // por último, o microfone padrão do sistema

    let problem: string | null = null
    for (const deviceId of attempts) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: deviceId ? { ...base, deviceId: { exact: deviceId } } : base
        })
        return { stream, problem: null }
      } catch (error) {
        problem ??= describeMediaError(error)
      }
    }
    return { stream: null, problem }
  }

  pause(): { at: number } {
    const capture = this.capture
    if (!capture) throw new Error('Não há captura em andamento')
    capture.audioRecorder.recorder.pause()
    capture.videoRecorder?.recorder.pause()
    if (capture.detector?.setPaused(true, performance.now()) === false) {
      this.bridge.sendEvent({ type: 'frames-stalled', stalled: false })
    }
    if (capture.watchdog?.setPaused(true, performance.now()) === false) {
      this.bridge.sendEvent({ type: 'video-stalled', stalled: false })
    }
    return { at: Date.now() }
  }

  resume(): { at: number } {
    const capture = this.capture
    if (!capture) throw new Error('Não há captura em andamento')
    capture.audioRecorder.recorder.resume()
    capture.videoRecorder?.recorder.resume()
    capture.detector?.setPaused(false, performance.now())
    capture.watchdog?.setPaused(false, performance.now())
    return { at: Date.now() }
  }

  /** Para os gravadores, espera o último pedaço chegar ao main e libera tudo. */
  async stop(): Promise<null> {
    const capture = this.capture
    if (!capture) return null
    this.capture = null
    for (const timer of capture.timers) window.clearInterval(timer)
    await Promise.all([capture.audioRecorder.stop(), capture.videoRecorder?.stop()])
    await capture.video?.stop()
    for (const stream of [capture.display, capture.mic]) {
      stream?.getTracks().forEach((track) => track.stop())
    }
    await capture.context.close().catch(() => undefined)
    return null
  }
}
