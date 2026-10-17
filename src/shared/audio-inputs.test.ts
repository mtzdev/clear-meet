import { describe, expect, it } from 'vitest'
import { checkInputs, planDisplayRequest, type CaptureInputs } from './audio-inputs'

const inputs = (hasVideo: boolean, mic: boolean, systemAudio: boolean): CaptureInputs => ({
  hasVideo,
  mic,
  systemAudio
})

describe('checkInputs', () => {
  it('com qualquer entrada de áudio, nada a avisar', () => {
    for (const hasVideo of [true, false]) {
      expect(checkInputs(inputs(hasVideo, true, true))).toEqual({ ok: true, warning: null })
      expect(checkInputs(inputs(hasVideo, true, false))).toEqual({ ok: true, warning: null })
      expect(checkInputs(inputs(hasVideo, false, true))).toEqual({ ok: true, warning: null })
    }
  })

  it('só áudio e nenhuma entrada: bloqueia', () => {
    expect(checkInputs(inputs(false, false, false))).toEqual({
      ok: false,
      problem: 'audio-only-needs-input'
    })
  })

  it('vídeo e nenhuma entrada: permite, avisando que não haverá Transcrição', () => {
    expect(checkInputs(inputs(true, false, false))).toEqual({ ok: true, warning: 'no-audio' })
  })
})

describe('planDisplayRequest', () => {
  it('vídeo com áudio do sistema: pede os dois', () => {
    expect(planDisplayRequest(inputs(true, true, true))).toEqual({ video: true, audio: true })
  })

  it('vídeo sem áudio do sistema: não pede loopback', () => {
    expect(planDisplayRequest(inputs(true, true, false))).toEqual({ video: true, audio: false })
    expect(planDisplayRequest(inputs(true, false, false))).toEqual({ video: true, audio: false })
  })

  it('só áudio com áudio do sistema: pede a tela só para obter o loopback', () => {
    expect(planDisplayRequest(inputs(false, true, true))).toEqual({ video: true, audio: true })
    expect(planDisplayRequest(inputs(false, false, true))).toEqual({ video: true, audio: true })
  })

  it('só áudio sem áudio do sistema: não captura a tela (nem pede permissão)', () => {
    expect(planDisplayRequest(inputs(false, true, false))).toBeNull()
  })
})
