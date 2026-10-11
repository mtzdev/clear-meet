import { describe, expect, it } from 'vitest'
import { renderTrayIcon } from './tray-icon'

describe('renderTrayIcon', () => {
  const size = 32
  const icon = renderTrayIcon(size)
  const pixel = (x: number, y: number) => {
    const offset = (y * size + x) * 4
    return {
      b: icon.readUInt8(offset),
      g: icon.readUInt8(offset + 1),
      r: icon.readUInt8(offset + 2),
      a: icon.readUInt8(offset + 3)
    }
  }

  it('tem 4 bytes por pixel', () => {
    expect(icon.length).toBe(size * size * 4)
  })

  it('centro opaco na cor de gravação e cantos transparentes', () => {
    expect(pixel(16, 16)).toEqual({ b: 0x48, g: 0x1d, r: 0xe1, a: 255 })
    expect(pixel(0, 0).a).toBe(0)
    expect(pixel(31, 31).a).toBe(0)
  })

  it('a borda é suavizada (alfa intermediário) e pré-multiplicada', () => {
    let partial = 0
    for (let x = 0; x < size; x++) {
      const { a, r } = pixel(x, 16)
      if (a > 0 && a < 255) {
        partial++
        expect(r).toBeLessThanOrEqual(a)
      }
    }
    expect(partial).toBeGreaterThan(0)
  })
})
