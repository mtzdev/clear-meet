import { describe, expect, it } from 'vitest'
import {
  NO_MIC,
  normalizeMicDevices,
  resolveMicChoice,
  type MicDevice,
  type RawMicDevice
} from './microphone'

const device = (deviceId: string, label: string, groupId: string): RawMicDevice => ({
  deviceId,
  label,
  groupId
})

// Lista como o Chromium entrega no Windows: "default" e "communications" repetem o dispositivo real.
const raw: RawMicDevice[] = [
  device('default', 'Default - Microphone (HyperX Cloud III)', 'g1'),
  device('communications', 'Communications - Microphone (HyperX Cloud III)', 'g1'),
  device('real-1', 'Microphone (HyperX Cloud III)', 'g1'),
  device('real-2', 'Microfone (Virtual Desktop Audio)', 'g2')
]

describe('normalizeMicDevices', () => {
  it('remove "default" e "communications" e marca o padrão do Windows', () => {
    expect(normalizeMicDevices(raw)).toEqual([
      { deviceId: 'real-1', label: 'Microphone (HyperX Cloud III)', isDefault: true },
      { deviceId: 'real-2', label: 'Microfone (Virtual Desktop Audio)', isDefault: false }
    ])
  })

  it('acha o padrão pelo rótulo quando o groupId não ajuda', () => {
    const list = normalizeMicDevices([
      device('default', 'Padrão - Headset', ''),
      device('a', 'Webcam', ''),
      device('b', 'Headset', '')
    ])
    expect(list.find((item) => item.isDefault)?.deviceId).toBe('b')
  })

  it('entre dispositivos do mesmo grupo, escolhe o de rótulo igual ao do padrão', () => {
    const list = normalizeMicDevices([
      device('default', 'Default - Stereo Mix', 'g'),
      device('a', 'Microphone Array', 'g'),
      device('b', 'Stereo Mix', 'g')
    ])
    expect(list.filter((item) => item.isDefault).map((item) => item.deviceId)).toEqual(['b'])
  })

  it('remove duplicatas idênticas (mesmo id ou mesmo rótulo e grupo), mas mantém dois aparelhos iguais em grupos diferentes', () => {
    const list = normalizeMicDevices([
      device('a', 'USB Mic', 'g1'),
      device('a', 'USB Mic', 'g1'),
      device('b', 'USB Mic', 'g1'),
      device('c', 'USB Mic', 'g2')
    ])
    expect(list.map((item) => item.deviceId)).toEqual(['a', 'c'])
  })

  it('sem pseudo-dispositivo "default" nenhum fica marcado', () => {
    expect(normalizeMicDevices([device('a', 'Mic', 'g')]).some((item) => item.isDefault)).toBe(
      false
    )
  })

  it('se só existe o pseudo-dispositivo, ele é mantido; ids vazios (sem permissão) são ignorados', () => {
    expect(normalizeMicDevices([device('default', 'Default - Mic', 'g')])).toEqual([
      { deviceId: 'default', label: 'Default - Mic', isDefault: true }
    ])
    expect(normalizeMicDevices([device('', '', '')])).toEqual([])
    expect(normalizeMicDevices([])).toEqual([])
  })
})

describe('resolveMicChoice', () => {
  const devices: MicDevice[] = normalizeMicDevices(raw)

  it('respeita "sem microfone"', () => {
    expect(resolveMicChoice(NO_MIC, devices)).toBe(NO_MIC)
  })

  it('usa o salvo se ainda existe', () => {
    expect(resolveMicChoice('real-2', devices)).toBe('real-2')
  })

  it('"default" ou "communications" salvos antes passam a apontar para o padrão do Windows', () => {
    expect(resolveMicChoice('default', devices)).toBe('real-1')
    expect(resolveMicChoice('communications', devices)).toBe('real-1')
  })

  it('cai no padrão se o salvo sumiu ou não há escolha', () => {
    expect(resolveMicChoice('desligado', devices)).toBe('real-1')
    expect(resolveMicChoice(null, devices)).toBe('real-1')
  })

  it('cai no primeiro dispositivo se nenhum é o padrão, e em "sem microfone" se não há nenhum', () => {
    expect(resolveMicChoice(null, [{ deviceId: 'abc', label: 'x', isDefault: false }])).toBe('abc')
    expect(resolveMicChoice(null, [])).toBe(NO_MIC)
  })
})
