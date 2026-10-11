import { describe, expect, it } from 'vitest'
import type { CaptureSourceInfo } from '@shared/recording'
import { AUDIO_ONLY, isSameSource, resolveSelection } from './source-selection'

const screen: CaptureSourceInfo = {
  id: 'screen:1:0',
  kind: 'screen',
  name: 'Tela 1',
  thumbnail: null,
  appIcon: null
}
const window1: CaptureSourceInfo = {
  id: 'window:2:0',
  kind: 'window',
  name: 'Reunião - Meet',
  thumbnail: null,
  appIcon: null
}

describe('resolveSelection', () => {
  it('sem escolha, usa a primeira tela', () => {
    expect(resolveSelection(null, [window1, screen])).toEqual({
      kind: 'screen',
      id: 'screen:1:0',
      name: 'Tela 1'
    })
  })

  it('mantém a escolha enquanto a fonte existe', () => {
    const chosen = { kind: 'window', id: 'window:2:0', name: 'Reunião - Meet' } as const
    expect(resolveSelection(chosen, [screen, window1])).toEqual(chosen)
  })

  it('volta para a tela se a janela escolhida fechou', () => {
    const chosen = { kind: 'window', id: 'window:9:0', name: 'Fechada' } as const
    expect(resolveSelection(chosen, [screen, window1]).kind).toBe('screen')
  })

  it('só áudio é sempre válido, e é o fallback sem telas', () => {
    expect(resolveSelection(AUDIO_ONLY, [screen])).toEqual(AUDIO_ONLY)
    expect(resolveSelection(null, [])).toEqual(AUDIO_ONLY)
  })
})

describe('isSameSource', () => {
  it('compara por tipo e id', () => {
    expect(isSameSource(AUDIO_ONLY, AUDIO_ONLY)).toBe(true)
    expect(isSameSource(null, null)).toBe(true)
    expect(isSameSource(AUDIO_ONLY, null)).toBe(false)
    expect(
      isSameSource(
        { kind: 'screen', id: 'a', name: 'x' },
        { kind: 'screen', id: 'a', name: 'outro nome' }
      )
    ).toBe(true)
    expect(
      isSameSource({ kind: 'screen', id: 'a', name: 'x' }, { kind: 'window', id: 'a', name: 'x' })
    ).toBe(false)
  })
})
