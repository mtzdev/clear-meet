import { computeFit, FrameRateLimiter, type Size } from '@shared/capture'

export interface VideoPipeline {
  /** Trilha do canvas (tamanho fixo) que vai ao `MediaRecorder` — nunca a trilha da captura. */
  track: MediaStreamTrack
  /** Tamanho da fonte no último quadro (informativo). */
  sourceSize(): Size
  /**
   * Referências que precisam ficar vivas enquanto a gravação dura: se o canvas ou o stream dele
   * forem coletados pelo garbage collector, a captura do canvas para de emitir quadros
   * (o gravador de vídeo "morre" em silêncio, de forma intermitente).
   */
  readonly keepAlive: readonly unknown[]
  /** Encerra a leitura dos quadros e espera o laço terminar. */
  stop(): Promise<void>
}

/**
 * Pipeline de vídeo (ADR 0002): a captura nunca vai direto ao gravador, porque redimensionar
 * a janela gravada corrompe o MP4. Cada quadro da fonte é lido por `MediaStreamTrackProcessor`,
 * desenhado num canvas de tamanho fixo — encaixado com letterbox, sem ampliar — e emitido por
 * `captureStream(0)` + `requestFrame()`: um quadro de saída por quadro de entrada, sem
 * `requestAnimationFrame` (que não roda com a janela oculta).
 *
 * O Windows Graphics Capture só entrega quadros quando o conteúdo muda: com a tela parada a
 * fonte fica segundos em silêncio. Para o codificador seguir recebendo quadros regulares (MP4
 * sem lacunas, bytes saindo do gravador, watchdog confiável), um timer repete o conteúdo atual
 * do canvas a `fps` quando a fonte não entrega nada. A repetição não segura nenhum
 * `VideoFrame` da captura (isso esgotaria o pool de buffers do WGC): redesenha o próprio canvas.
 */
export function startVideoPipeline(options: {
  source: MediaStreamTrack
  canvas: Size
  fps: number
  /** Chamado a cada quadro entregue ao gravador (`requestFrame`), inclusive as repetições. */
  onFed: () => void
  onError: (message: string) => void
}): VideoPipeline {
  const { source, canvas: size, fps } = options
  const element = document.createElement('canvas')
  element.width = size.width
  element.height = size.height
  const context = element.getContext('2d', { alpha: false })
  if (!context) throw new Error('Canvas 2D indisponível')
  context.fillStyle = '#000'
  context.fillRect(0, 0, size.width, size.height)

  const output = element.captureStream(0)
  const track = output.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack | undefined
  if (!track) throw new Error('O canvas não gerou trilha de vídeo')

  const reader = new MediaStreamTrackProcessor({ track: source }).readable.getReader()
  const limiter = new FrameRateLimiter(fps)
  let fitKey = ''
  let lastSource: Size = { width: 0, height: 0 }
  let reportedError = false
  let lastSourceAt = performance.now()
  const intervalMs = 1000 / fps

  const loop = (async () => {
    for (;;) {
      let result: ReadableStreamReadResult<VideoFrame>
      try {
        result = await reader.read()
      } catch {
        break
      }
      if (result.done) break
      const frame = result.value
      try {
        lastSourceAt = performance.now()
        // Teto de fps: descarta o excesso se a fonte entregar mais que o pedido.
        if (!limiter.accept(frame.timestamp)) continue

        lastSource = { width: frame.displayWidth, height: frame.displayHeight }
        const fit = computeFit(lastSource, size)
        const key = `${fit.width}x${fit.height}@${fit.x},${fit.y}`
        if (key !== fitKey) {
          // O encaixe mudou (janela redimensionada): limpa as faixas pretas antes de desenhar.
          context.fillStyle = '#000'
          context.fillRect(0, 0, size.width, size.height)
          fitKey = key
        }
        context.drawImage(frame, fit.x, fit.y, fit.width, fit.height)
        track.requestFrame()
        options.onFed()
      } catch (error) {
        if (!reportedError) {
          reportedError = true
          options.onError(`Erro ao desenhar um quadro: ${String(error)}`)
        }
      } finally {
        frame.close()
      }
    }
  })()

  // Repete o último conteúdo enquanto a fonte está calada (tela/janela parada). Com a fonte
  // ativa nunca entra: só depois de 1,5 intervalo sem quadro dela, o que absorve o jitter.
  const repeatTimer = window.setInterval(() => {
    if (performance.now() - lastSourceAt < intervalMs * 1.5) return
    try {
      // `requestFrame()` num canvas inalterado pode não gerar quadro; redesenhar o canvas
      // sobre si mesmo o marca como modificado sem alterar nenhum pixel.
      context.drawImage(element, 0, 0)
      track.requestFrame()
      options.onFed()
    } catch (error) {
      if (!reportedError) {
        reportedError = true
        options.onError(`Erro ao repetir o último quadro: ${String(error)}`)
      }
    }
  }, intervalMs)

  return {
    track,
    keepAlive: [element, context, output, reader],
    sourceSize: () => lastSource,
    async stop() {
      window.clearInterval(repeatTimer)
      await reader.cancel().catch(() => undefined)
      await loop
      track.stop()
    }
  }
}

/**
 * Tamanho real da fonte, lido do primeiro quadro entregue (`getSettings()` da captura pode
 * devolver o máximo pedido em vez do tamanho da janela). `null` se nenhum quadro chegar a tempo
 * (janela minimizada desde o início, por exemplo).
 */
export async function peekSourceSize(
  track: MediaStreamTrack,
  timeoutMs = 3000
): Promise<Size | null> {
  const reader = new MediaStreamTrackProcessor({ track }).readable.getReader()
  let timer: number | undefined
  try {
    const timeout = new Promise<null>((resolve) => {
      timer = window.setTimeout(() => resolve(null), timeoutMs)
    })
    const result = await Promise.race([reader.read(), timeout])
    if (result === null || result.done) return null
    const size = { width: result.value.displayWidth, height: result.value.displayHeight }
    result.value.close()
    return size
  } catch {
    return null
  } finally {
    window.clearTimeout(timer)
    await reader.cancel().catch(() => undefined)
  }
}
