/**
 * Mix do Áudio da reunião: microfone + áudio do sistema (loopback) num só sinal mono, com
 * limitador. Somar duas fontes pode passar de 0 dBFS (no teste manual da Fase 0 o mix bateu
 * 0 dBFS de pico) e o clipping distorce a voz para a Transcrição.
 *
 * Cadeia: soma -> compressor configurado como limitador (rápido, razão alta) -> rede de
 * segurança (curva suave que nunca passa de ~0,95) -> saída.
 */

/** Pico máximo que a rede de segurança permite (~ -0,45 dBFS). */
const CEILING = 0.95
/** Acima deste nível a curva de segurança começa a achatar o sinal. */
const KNEE_START = 0.8

/** Curva de saturação suave: identidade até `KNEE_START` e depois tende a `CEILING`. */
export function createSafetyCurve(points = 2048): Float32Array<ArrayBuffer> {
  const curve = new Float32Array(points)
  for (let index = 0; index < points; index++) {
    const x = (index / (points - 1)) * 2 - 1
    const magnitude = Math.abs(x)
    let y = magnitude
    if (magnitude > KNEE_START) {
      const room = CEILING - KNEE_START
      y = KNEE_START + room * Math.tanh((magnitude - KNEE_START) / room)
    }
    curve[index] = Math.sign(x) * Math.min(y, CEILING)
  }
  return curve
}

export interface MixChain {
  /** Ligue aqui todas as fontes (mic, loopback). */
  input: AudioNode
  /** Saída já limitada; ligue ao destino. */
  output: AudioNode
}

export function createMixChain(context: BaseAudioContext): MixChain {
  const bus = context.createGain()
  bus.gain.value = 1

  const limiter = context.createDynamicsCompressor()
  limiter.threshold.value = -6
  limiter.knee.value = 0
  limiter.ratio.value = 20
  limiter.attack.value = 0.001
  limiter.release.value = 0.12

  const safety = context.createWaveShaper()
  safety.curve = createSafetyCurve()
  safety.oversample = '2x'

  bus.connect(limiter)
  limiter.connect(safety)
  return { input: bus, output: safety }
}

/** Maior valor absoluto das amostras, em dBFS (-Infinity para silêncio). */
export function peakDbfs(samples: Float32Array): number {
  let peak = 0
  for (const sample of samples) peak = Math.max(peak, Math.abs(sample))
  return peak > 0 ? 20 * Math.log10(peak) : -Infinity
}

/**
 * Autoteste do limitador (só para a verificação em desenvolvimento): renderiza duas senoides a
 * 0 dBFS somadas, com e sem a cadeia, e mede o pico de cada uma.
 */
export async function measureLimiter(): Promise<{ rawPeakDbfs: number; limitedPeakDbfs: number }> {
  const SAMPLE_RATE = 48_000
  const LENGTH = SAMPLE_RATE // 1 s

  const render = async (limited: boolean): Promise<number> => {
    const context = new OfflineAudioContext(1, LENGTH, SAMPLE_RATE)
    const chain = limited ? createMixChain(context) : null
    for (const frequency of [440, 660]) {
      const oscillator = context.createOscillator()
      oscillator.frequency.value = frequency
      oscillator.connect(chain ? chain.input : context.destination)
      oscillator.start()
    }
    chain?.output.connect(context.destination)
    const buffer = await context.startRendering()
    // Mede o trecho inteiro, inclusive o início, onde o limitador ainda está "armando".
    return peakDbfs(buffer.getChannelData(0))
  }

  return { rawPeakDbfs: await render(false), limitedPeakDbfs: await render(true) }
}
