import { useEffect, useState } from 'react'
import { smoothLevel } from './audio-level'

export interface MicDevice {
  deviceId: string
  label: string
}

/** Valor guardado em `settings.micDeviceId` para "gravar sem microfone". */
export const NO_MIC = 'none'

/**
 * Escolha efetiva do microfone: a salva (`NO_MIC` ou um `deviceId`) se ainda existe; senão o
 * dispositivo padrão do sistema; senão o primeiro; senão `NO_MIC` (nenhum dispositivo).
 */
export function resolveMicChoice(saved: string | null, devices: MicDevice[]): string {
  if (saved === NO_MIC) return NO_MIC
  if (saved && devices.some((device) => device.deviceId === saved)) return saved
  const fallback = devices.find((device) => device.deviceId === 'default') ?? devices[0]
  return fallback ? fallback.deviceId : NO_MIC
}

export interface MicDevices {
  devices: MicDevice[]
  /** Por que a lista está vazia ou sem nomes (permissão negada, sem dispositivos…). */
  problem: string | null
  refresh: () => void
}

/** Microfones do sistema. A permissão é pedida uma vez: sem ela o Chromium não revela os nomes. */
export function useMicDevices(): MicDevices {
  const [devices, setDevices] = useState<MicDevice[]>([])
  const [problem, setProblem] = useState<string | null>(null)
  const [version, setVersion] = useState(0)

  useEffect(() => {
    let cancelled = false

    const load = async (): Promise<void> => {
      let nextProblem: string | null = null
      try {
        const probe = await navigator.mediaDevices.getUserMedia({ audio: true })
        probe.getTracks().forEach((track) => track.stop())
      } catch (error) {
        const name = error instanceof DOMException ? error.name : ''
        nextProblem =
          name === 'NotAllowedError'
            ? 'O acesso ao microfone foi negado. Libere-o nas configurações de privacidade do Windows.'
            : 'Nenhum microfone encontrado.'
      }
      const all = await navigator.mediaDevices.enumerateDevices()
      if (cancelled) return
      setProblem(nextProblem)
      setDevices(
        all
          .filter((device) => device.kind === 'audioinput')
          .map((device) => ({ deviceId: device.deviceId, label: device.label }))
      )
    }

    void load()
    const onChange = (): void => void load()
    navigator.mediaDevices.addEventListener('devicechange', onChange)
    return () => {
      cancelled = true
      navigator.mediaDevices.removeEventListener('devicechange', onChange)
    }
  }, [version])

  return { devices, problem, refresh: () => setVersion((current) => current + 1) }
}

/**
 * Nível ao vivo (0 a 1, pico em dB suavizado) do microfone escolhido, para o usuário ver
 * se ele está captando antes de gravar. `deviceId === null` desliga a escuta.
 */
export function useMicPreviewLevel(deviceId: string | null): number {
  const [level, setLevel] = useState(0)

  useEffect(() => {
    if (deviceId === null) return
    let stopped = false
    let stream: MediaStream | null = null
    let context: AudioContext | null = null
    let timer = 0

    void (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            deviceId: { exact: deviceId },
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false
          }
        })
        if (stopped) {
          stream.getTracks().forEach((track) => track.stop())
          return
        }
        context = new AudioContext()
        const analyser = context.createAnalyser()
        analyser.fftSize = 1024
        context.createMediaStreamSource(stream).connect(analyser)
        const samples = new Float32Array(analyser.fftSize)
        let smoothed = 0
        let last = performance.now()
        timer = window.setInterval(() => {
          analyser.getFloatTimeDomainData(samples)
          let peak = 0
          for (const sample of samples) peak = Math.max(peak, Math.abs(sample))
          const now = performance.now()
          smoothed = smoothLevel(smoothed, Math.min(1, peak), now - last)
          last = now
          setLevel(smoothed)
        }, 70)
      } catch {
        // Sem permissão ou dispositivo ocupado: o seletor já mostra o problema.
      }
    })()

    return () => {
      stopped = true
      window.clearInterval(timer)
      stream?.getTracks().forEach((track) => track.stop())
      void context?.close()
      setLevel(0)
    }
  }, [deviceId])

  return deviceId === null ? 0 : level
}
