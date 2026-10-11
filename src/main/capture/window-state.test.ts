import { describe, expect, it } from 'vitest'
import { parseWindowHandle } from './window-state'

describe('parseWindowHandle', () => {
  it('lê o HWND (decimal) do id de uma janela do desktopCapturer', () => {
    expect(parseWindowHandle('window:197384:0')).toBe(197384)
    expect(parseWindowHandle('window:2231518:0')).toBe(2231518)
  })

  it('aceita HWNDs grandes, dentro do inteiro seguro', () => {
    expect(parseWindowHandle('window:4294967295:0')).toBe(4294967295)
  })

  it('devolve null para telas e formatos desconhecidos', () => {
    expect(parseWindowHandle('screen:0:0')).toBeNull()
    expect(parseWindowHandle('window:abc:0')).toBeNull()
    expect(parseWindowHandle('window::0')).toBeNull()
    expect(parseWindowHandle('window:12')).toBeNull()
    expect(parseWindowHandle('window:0:0')).toBeNull()
    expect(parseWindowHandle('window:99999999999999999999:0')).toBeNull()
    expect(parseWindowHandle('')).toBeNull()
  })
})
