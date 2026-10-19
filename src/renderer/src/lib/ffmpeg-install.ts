import { useCallback, useEffect, useRef, useState } from 'react'
import { IDLE_FFMPEG_INSTALL, isFfmpegInstalling, type FfmpegInstallState } from '@shared/ffmpeg'
import { formatBytes } from './format'
import { useIpcQuery } from './ipc'

/** Andamento da instalação do FFmpeg: eventos do main mais o pedido para começar. */
export function useFfmpegInstall(): { state: FfmpegInstallState; start: () => void } {
  const [state, setState] = useState<FfmpegInstallState>(IDLE_FFMPEG_INSTALL)
  useEffect(() => window.api.on('ffmpeg:install', setState), [])
  const start = useCallback(() => {
    setState({ ...IDLE_FFMPEG_INSTALL, phase: 'download' })
    void window.api.invoke('ffmpeg:install').then(setState)
  }, [])
  return { state, start }
}

export interface FfmpegSetup {
  /** Consultando o estado do FFmpeg. */
  checking: boolean
  ready: boolean
  installing: boolean
  install: FfmpegInstallState
  /** Baixa o FFmpeg (ou tenta de novo depois de um erro). */
  retry: () => void
  /** Relê o estado do FFmpeg. */
  reload: () => void
}

/**
 * Estado do FFmpeg para quem precisa dele pronto. Com `autoStart`, baixa sozinho assim que vê que
 * ele não está disponível; ao terminar a instalação, consulta o estado de novo.
 */
export function useFfmpegSetup(autoStart: boolean): FfmpegSetup {
  const query = useIpcQuery('ffmpeg:status')
  const { state, start } = useFfmpegInstall()
  const started = useRef(false)
  const available = query.status === 'ready' ? query.data.available : null
  const { reload } = query

  useEffect(() => {
    if (!autoStart || available !== false || started.current) return
    started.current = true
    start()
  }, [autoStart, available, start])

  useEffect(() => {
    if (state.phase === 'done') reload()
  }, [state.phase, reload])

  const installing = isFfmpegInstalling(state)
  return {
    checking: query.status === 'loading' || (state.phase === 'done' && available === false),
    ready: available === true && !installing,
    installing,
    install: state,
    retry: start,
    reload
  }
}

/** Texto curto do que a instalação está fazendo agora. */
export function describeInstall(state: FfmpegInstallState): string {
  switch (state.phase) {
    case 'download':
      if (state.totalBytes !== null) {
        return `Baixando… ${formatBytes(state.receivedBytes)} de ${formatBytes(state.totalBytes)}`
      }
      return state.receivedBytes > 0 ? `Baixando… ${formatBytes(state.receivedBytes)}` : 'Baixando…'
    case 'verify':
      return 'Verificando o arquivo…'
    case 'extract':
      return 'Extraindo…'
    case 'validate':
      return 'Testando a instalação…'
    case 'done':
      return 'Instalado.'
    case 'error':
      return state.error ?? 'Não foi possível instalar.'
    default:
      return ''
  }
}

/** Andamento de 0 a 100 do download; as etapas seguintes contam como concluído. `null` = sem tamanho. */
export function installPercent(state: FfmpegInstallState): number | null {
  if (state.phase === 'download') {
    if (state.totalBytes === null || state.totalBytes <= 0) return null
    return Math.min(100, Math.floor((state.receivedBytes / state.totalBytes) * 100))
  }
  return state.phase === 'idle' ? 0 : 100
}
