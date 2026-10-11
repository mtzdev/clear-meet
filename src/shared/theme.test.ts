import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { WINDOW_BACKGROUND } from './theme'

const tokens = readFileSync(resolve(__dirname, '../renderer/src/styles/tokens.css'), 'utf8')

function backgroundIn(selector: string): string | undefined {
  const block = new RegExp(`^${selector}\\s*\\{([^}]*)\\}`, 'm').exec(tokens)?.[1]
  return block && /--background:\s*(#[0-9a-f]{6})/i.exec(block)?.[1]
}

describe('tokens de tema', () => {
  it('a cor de fundo da janela (main) bate com --background do CSS', () => {
    expect(backgroundIn(':root')).toBe(WINDOW_BACKGROUND.light)
    expect(backgroundIn('\\.dark')).toBe(WINDOW_BACKGROUND.dark)
  })
})
