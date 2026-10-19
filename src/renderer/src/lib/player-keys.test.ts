import { describe, expect, it } from 'vitest'
import { isInsideOverlay, isTextEntry, PLAYER_SHORTCUTS, playerKeyAction } from './player-keys'

const FREE = { inTextField: false, inOverlay: false, modified: false }

describe('playerKeyAction', () => {
  it('espaço alterna, setas saltam', () => {
    expect(playerKeyAction(' ', FREE)).toBe('toggle')
    expect(playerKeyAction('ArrowLeft', FREE)).toBe('back')
    expect(playerKeyAction('ArrowRight', FREE)).toBe('forward')
  })

  it('ignora outras teclas', () => {
    expect(playerKeyAction('a', FREE)).toBeNull()
    expect(playerKeyAction('Enter', FREE)).toBeNull()
    expect(playerKeyAction('ArrowUp', FREE)).toBeNull()
  })

  it('não age em campo de texto, em diálogo/menu aberto nem com Ctrl/Alt/Meta', () => {
    expect(playerKeyAction(' ', { ...FREE, inTextField: true })).toBeNull()
    expect(playerKeyAction('ArrowLeft', { ...FREE, inTextField: true })).toBeNull()
    expect(playerKeyAction(' ', { ...FREE, inOverlay: true })).toBeNull()
    expect(playerKeyAction('ArrowRight', { ...FREE, modified: true })).toBeNull()
  })
})

describe('atalhos do player', () => {
  it('K alterna; J/L e Shift + setas saltam 15 s', () => {
    expect(playerKeyAction('k', FREE)).toBe('toggle')
    expect(playerKeyAction('K', FREE)).toBe('toggle')
    expect(playerKeyAction('j', FREE)).toBe('back-long')
    expect(playerKeyAction('L', FREE)).toBe('forward-long')
    expect(playerKeyAction('ArrowLeft', { ...FREE, shift: true })).toBe('back-long')
    expect(playerKeyAction('ArrowRight', { ...FREE, shift: true })).toBe('forward-long')
  })

  it('M, F e zoom', () => {
    expect(playerKeyAction('m', FREE)).toBe('mute')
    expect(playerKeyAction('F', FREE)).toBe('fullscreen')
    expect(playerKeyAction('+', FREE)).toBe('zoom-in')
    expect(playerKeyAction('=', FREE)).toBe('zoom-in')
    expect(playerKeyAction('-', FREE)).toBe('zoom-out')
    expect(playerKeyAction('0', FREE)).toBe('zoom-reset')
  })

  it('quadro a quadro só com o vídeo pausado', () => {
    expect(playerKeyAction(',', FREE)).toBeNull()
    expect(playerKeyAction('.', { ...FREE, paused: false })).toBeNull()
    expect(playerKeyAction(',', { ...FREE, paused: true })).toBe('frame-back')
    expect(playerKeyAction('.', { ...FREE, paused: true })).toBe('frame-forward')
  })

  it('nenhum atalho novo age em campo de texto, diálogo ou com Ctrl', () => {
    for (const key of ['k', 'j', 'l', 'm', 'f', '+', '-', '0', ',', '.']) {
      expect(playerKeyAction(key, { ...FREE, inTextField: true, paused: true })).toBeNull()
      expect(playerKeyAction(key, { ...FREE, inOverlay: true, paused: true })).toBeNull()
      expect(playerKeyAction(key, { ...FREE, modified: true, paused: true })).toBeNull()
    }
  })

  it('a ajuda separa os atalhos que só valem com vídeo', () => {
    expect(PLAYER_SHORTCUTS.some((shortcut) => shortcut.video)).toBe(true)
    expect(PLAYER_SHORTCUTS.some((shortcut) => !shortcut.video)).toBe(true)
  })
})

describe('isTextEntry', () => {
  it('reconhece onde se digita', () => {
    expect(isTextEntry({ tagName: 'TEXTAREA' })).toBe(true)
    expect(isTextEntry({ tagName: 'INPUT', type: 'text' })).toBe(true)
    expect(isTextEntry({ tagName: 'INPUT' })).toBe(true)
    expect(isTextEntry({ tagName: 'INPUT', type: 'search' })).toBe(true)
    expect(isTextEntry({ tagName: 'SELECT' })).toBe(true)
    expect(isTextEntry({ tagName: 'DIV', isContentEditable: true })).toBe(true)
  })

  it('botões, caixas de seleção e o resto não são campos de texto', () => {
    expect(isTextEntry({ tagName: 'BUTTON' })).toBe(false)
    expect(isTextEntry({ tagName: 'INPUT', type: 'checkbox' })).toBe(false)
    expect(isTextEntry({ tagName: 'INPUT', type: 'range' })).toBe(false)
    expect(isTextEntry({ tagName: 'DIV' })).toBe(false)
    expect(isTextEntry(null)).toBe(false)
  })
})

describe('isInsideOverlay', () => {
  it('usa closest para achar diálogos e menus', () => {
    expect(isInsideOverlay({ closest: () => ({}) })).toBe(true)
    expect(isInsideOverlay({ closest: () => null })).toBe(false)
    expect(isInsideOverlay({})).toBe(false)
    expect(isInsideOverlay(null)).toBe(false)
  })
})
