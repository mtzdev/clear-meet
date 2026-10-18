import { inflateSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { encodeIco, encodePng, ICO_SIZES, renderIconRgba } from './icon'

describe('renderIconRgba', () => {
  const size = 64
  const rgba = renderIconRgba(size)
  const pixel = (x: number, y: number): number[] => {
    const offset = (y * size + x) * 4
    return [rgba[offset]!, rgba[offset + 1]!, rgba[offset + 2]!, rgba[offset + 3]!]
  }

  it('deixa os cantos transparentes', () => {
    expect(pixel(0, 0)[3]).toBe(0)
    expect(pixel(size - 1, size - 1)[3]).toBe(0)
  })

  it('desenha a barra central em branco e o fundo opaco em índigo', () => {
    expect(pixel(size / 2, size / 2)).toEqual([255, 255, 255, 255])
    const background = pixel(Math.round(size * 0.15), size / 2)
    expect(background[3]).toBe(255)
    expect(background[2]).toBeGreaterThan(background[0]!)
  })
})

describe('encodePng', () => {
  it('gera um PNG RGBA com as dimensões e os pixels originais', () => {
    const size = 8
    const source = renderIconRgba(size)
    const png = encodePng(source, size)
    expect(png.subarray(0, 8)).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    )
    expect(png.readUInt32BE(16)).toBe(size)
    expect(png.readUInt32BE(20)).toBe(size)
    const idatStart = png.indexOf('IDAT') + 4
    const idatLength = png.readUInt32BE(idatStart - 8)
    const raw = inflateSync(png.subarray(idatStart, idatStart + idatLength))
    expect(raw.length).toBe((size * 4 + 1) * size)
    expect(raw.subarray(1, 1 + size * 4)).toEqual(source.subarray(0, size * 4))
  })
})

describe('encodeIco', () => {
  const images = ICO_SIZES.map((size) => ({ size, rgba: renderIconRgba(size) }))
  const ico = encodeIco(images)

  it('lista todas as resoluções no diretório', () => {
    expect(ico.readUInt16LE(2)).toBe(1)
    expect(ico.readUInt16LE(4)).toBe(ICO_SIZES.length)
    const widths = ICO_SIZES.map((_, index) => ico[6 + index * 16])
    expect(widths).toEqual([16, 24, 32, 48, 64, 128, 0])
  })

  it('aponta cada entrada para uma imagem dentro do arquivo', () => {
    ICO_SIZES.forEach((size, index) => {
      const entry = 6 + index * 16
      const length = ico.readUInt32LE(entry + 8)
      const offset = ico.readUInt32LE(entry + 12)
      expect(offset + length).toBeLessThanOrEqual(ico.length)
      const isPng = ico.subarray(offset, offset + 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]))
      expect(isPng).toBe(size === 256)
      if (!isPng) expect(ico.readInt32LE(offset + 8)).toBe(size * 2)
    })
  })
})
