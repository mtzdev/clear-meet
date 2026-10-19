import { describe, expect, it } from 'vitest'
import {
  captureShortcut,
  formatAccelerator,
  formatModifiers,
  keyFromCode,
  normalizeAccelerator,
  type ShortcutKeyEvent
} from './shortcut'

function press(code: string, modifiers: Partial<ShortcutKeyEvent> = {}): ShortcutKeyEvent {
  return { code, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...modifiers }
}

describe('captureShortcut', () => {
  it('monta o acelerador na ordem Ctrl, Alt, Shift, Win', () => {
    expect(captureShortcut(press('Space', { ctrlKey: true, shiftKey: true }))).toEqual({
      kind: 'ok',
      accelerator: 'Ctrl+Shift+Space'
    })
    expect(
      captureShortcut(press('KeyN', { shiftKey: true, altKey: true, ctrlKey: true, metaKey: true }))
    ).toEqual({ kind: 'ok', accelerator: 'Ctrl+Alt+Shift+Super+N' })
  })

  it('só modificadores apertados: espera a tecla', () => {
    expect(captureShortcut(press('ControlLeft', { ctrlKey: true }))).toEqual({
      kind: 'pending',
      modifiers: ['Ctrl']
    })
    expect(captureShortcut(press('ShiftRight', { ctrlKey: true, shiftKey: true }))).toEqual({
      kind: 'pending',
      modifiers: ['Ctrl', 'Shift']
    })
  })

  it('exige modificador: tecla sozinha é recusada', () => {
    const result = captureShortcut(press('KeyN'))
    expect(result.kind).toBe('invalid')
    expect(captureShortcut(press('F5')).kind).toBe('invalid')
  })

  it('Shift sozinho só vale com teclas de função', () => {
    expect(captureShortcut(press('KeyN', { shiftKey: true })).kind).toBe('invalid')
    expect(captureShortcut(press('Digit1', { shiftKey: true })).kind).toBe('invalid')
    expect(captureShortcut(press('F9', { shiftKey: true }))).toEqual({
      kind: 'ok',
      accelerator: 'Shift+F9'
    })
  })

  it('teclas sem equivalente são recusadas (Esc, Caps Lock, mídia)', () => {
    for (const code of ['Escape', 'CapsLock', 'MediaPlayPause', 'ContextMenu', 'PrintScreen']) {
      expect(captureShortcut(press(code, { ctrlKey: true })).kind).toBe('invalid')
    }
  })

  it('usa o código físico: pontuação, setas, teclado numérico e F1-F24', () => {
    expect(captureShortcut(press('Slash', { ctrlKey: true }))).toEqual({
      kind: 'ok',
      accelerator: 'Ctrl+/'
    })
    expect(captureShortcut(press('ArrowUp', { altKey: true }))).toEqual({
      kind: 'ok',
      accelerator: 'Alt+Up'
    })
    expect(captureShortcut(press('Numpad5', { ctrlKey: true }))).toEqual({
      kind: 'ok',
      accelerator: 'Ctrl+num5'
    })
    expect(captureShortcut(press('F24', { ctrlKey: true }))).toEqual({
      kind: 'ok',
      accelerator: 'Ctrl+F24'
    })
    expect(keyFromCode('F25')).toBeNull()
    expect(keyFromCode('Digit7')).toBe('7')
  })
})

describe('normalizeAccelerator', () => {
  it('aceita o padrão do app e aliases do Electron, normalizando', () => {
    expect(normalizeAccelerator('Ctrl+Shift+Space')).toBe('Ctrl+Shift+Space')
    expect(normalizeAccelerator('CommandOrControl+Shift+N')).toBe('Ctrl+Shift+N')
    expect(normalizeAccelerator('  control + alt + f12 ')).toBe('Ctrl+Alt+F12')
    expect(normalizeAccelerator('Super+Return')).toBe('Super+Enter')
    expect(normalizeAccelerator('Ctrl+Ctrl+A')).toBe('Ctrl+A')
  })

  it('aceita o "+" como tecla', () => {
    expect(normalizeAccelerator('Ctrl++')).toBe('Ctrl+Plus')
    expect(normalizeAccelerator('Ctrl+Plus')).toBe('Ctrl+Plus')
  })

  it('recusa sem modificador, sem tecla, com tecla ou modificador desconhecidos', () => {
    for (const value of [
      'N',
      'Ctrl',
      'Ctrl+',
      '+N',
      'Shift+N',
      'Ctrl+Banana',
      'Hyper+N',
      'Ctrl+Esc',
      'Ctrl+Escape',
      'Ctrl+A+B',
      '',
      '   ',
      42,
      null,
      undefined
    ]) {
      expect(normalizeAccelerator(value)).toBeNull()
    }
  })
})

describe('texto para exibir', () => {
  it('traduz os nomes e separa com " + "', () => {
    expect(formatAccelerator('Ctrl+Shift+Space')).toBe('Ctrl + Shift + Espaço')
    expect(formatAccelerator('Super+Up')).toBe('Win + ↑')
    expect(formatAccelerator('Ctrl+num3')).toBe('Ctrl + Num 3')
    expect(formatModifiers(['Ctrl', 'Super'])).toBe('Ctrl + Win')
  })
})
