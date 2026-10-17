/**
 * Entradas de áudio da Reunião (microfone e áudio do sistema) e o que cada combinação exige
 * da captura. Lógica pura, usada pela UI, pelo serviço de gravação e pela janela de gravação.
 */

export interface CaptureInputs {
  /** Há Fonte de captura de vídeo (tela ou janela). */
  hasVideo: boolean
  mic: boolean
  systemAudio: boolean
}

export type InputsProblem = 'audio-only-needs-input'
export type InputsWarning = 'no-audio'

export const INPUTS_PROBLEM_TEXT: Record<InputsProblem, string> = {
  'audio-only-needs-input': 'Ative o microfone ou o áudio do sistema para gravar só áudio.'
}

export const INPUTS_WARNING_TEXT: Record<InputsWarning, string> = {
  'no-audio': 'Sem nenhuma entrada de áudio, a Reunião não terá Transcrição.'
}

export type InputsCheck =
  { ok: true; warning: InputsWarning | null } | { ok: false; problem: InputsProblem }

/** Reunião só de áudio exige uma entrada; com vídeo e sem áudio é permitido, com aviso. */
export function checkInputs(inputs: CaptureInputs): InputsCheck {
  if (inputs.mic || inputs.systemAudio) return { ok: true, warning: null }
  if (!inputs.hasVideo) return { ok: false, problem: 'audio-only-needs-input' }
  return { ok: true, warning: 'no-audio' }
}

export interface DisplayRequest {
  /**
   * Pede vídeo ao `getDisplayMedia`. Na Reunião só de áudio com áudio do sistema o vídeo
   * também é pedido (o loopback só vem junto com uma tela) e descartado em seguida.
   */
  video: boolean
  /** Pede o loopback do sistema. */
  audio: boolean
}

/** O que pedir ao `getDisplayMedia`; `null` = nem chamar (não há vídeo nem áudio do sistema). */
export function planDisplayRequest(inputs: CaptureInputs): DisplayRequest | null {
  if (!inputs.hasVideo && !inputs.systemAudio) return null
  return { video: true, audio: inputs.systemAudio }
}
