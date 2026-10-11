import type { RecordingWarning, StopReason } from '@shared/recording'

/** Textos (pt-BR) dos avisos e dos motivos de parada. */
export const WARNING_TEXT: Record<RecordingWarning, { title: string; detail: string }> = {
  'window-minimized': {
    title: 'A janela gravada está minimizada — o vídeo fica congelado',
    detail:
      'O áudio continua sendo gravado. Restaure a janela (ou tire o que a cobre) para o vídeo voltar a se mover.'
  },
  'low-disk': {
    title: 'Pouco espaço livre no disco',
    detail: 'A gravação é encerrada com segurança se o espaço acabar.'
  },
  'video-encoder-stalled': {
    title: 'O vídeo parou de ser gravado',
    detail:
      'O codificador de vídeo do computador travou. O áudio continua sendo gravado; se o vídeo for importante, pare e inicie uma nova gravação.'
  },
  'mic-unavailable': {
    title: 'O microfone não pôde ser usado',
    detail: 'Só o áudio do sistema está sendo gravado.'
  }
}

export const STOP_REASON_TEXT: Partial<Record<StopReason, string>> = {
  'source-ended': 'A janela ou tela gravada foi fechada, então a gravação foi encerrada.',
  'low-disk': 'O espaço livre no disco acabou, então a gravação foi encerrada com segurança.',
  'write-error': 'Não foi possível gravar no disco, então a gravação foi encerrada.',
  'recorder-crashed': 'O gravador parou de funcionar, então a gravação foi encerrada.',
  'app-quit': 'O app foi fechado durante a gravação.'
}
