import { describe, expect, it } from 'vitest'
import { NO_MIC, resolveMicChoice, type MicDevice } from './microphone'

const devices: MicDevice[] = [
  { deviceId: 'default', label: 'Padrão - Microfone (USB)' },
  { deviceId: 'abc', label: 'Microfone (USB)' },
  { deviceId: 'xyz', label: 'Headset' }
]

describe('resolveMicChoice', () => {
  it('respeita "sem microfone"', () => {
    expect(resolveMicChoice(NO_MIC, devices)).toBe(NO_MIC)
  })

  it('usa o salvo se ainda existe', () => {
    expect(resolveMicChoice('xyz', devices)).toBe('xyz')
  })

  it('cai no padrão do sistema se o salvo sumiu ou não há escolha', () => {
    expect(resolveMicChoice('desligado', devices)).toBe('default')
    expect(resolveMicChoice(null, devices)).toBe('default')
  })

  it('cai no primeiro dispositivo se não há "default", e em "sem microfone" se não há nenhum', () => {
    expect(resolveMicChoice(null, [{ deviceId: 'abc', label: 'x' }])).toBe('abc')
    expect(resolveMicChoice(null, [])).toBe(NO_MIC)
  })
})
