/**
 * Ícone provisório do app, desenhado em código: um quadrado arredondado índigo (a cor primária
 * da UI) com barras de áudio brancas, como o logotipo da barra lateral. Para trocar por uma
 * arte final, basta substituir `build/icon.png` e `build/icon.ico`.
 */
import { crc32, deflateSync } from 'node:zlib'

export const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256] as const

const TOP = { r: 0x63, g: 0x66, b: 0xf1 }
const BOTTOM = { r: 0x43, g: 0x38, b: 0xca }
const SAMPLES = 4

/** Alturas das barras (fração do lado), da esquerda para a direita. */
const BARS = [0.22, 0.4, 0.62, 0.4, 0.22]
const BAR_WIDTH = 0.07
const BAR_GAP = 0.052

interface Rgba {
  r: number
  g: number
  b: number
  a: number
}

function insideRoundedRect(
  x: number,
  y: number,
  left: number,
  top: number,
  right: number,
  bottom: number,
  radius: number
): boolean {
  if (x < left || x > right || y < top || y > bottom) return false
  const cx = x < left + radius ? left + radius : x > right - radius ? right - radius : x
  const cy = y < top + radius ? top + radius : y > bottom - radius ? bottom - radius : y
  return Math.hypot(x - cx, y - cy) <= radius
}

function insideBar(x: number, y: number): boolean {
  const total = BARS.length * BAR_WIDTH + (BARS.length - 1) * BAR_GAP
  const start = (1 - total) / 2
  for (let i = 0; i < BARS.length; i++) {
    const left = start + i * (BAR_WIDTH + BAR_GAP)
    const half = (BARS[i] ?? 0) / 2
    if (insideRoundedRect(x, y, left, 0.5 - half, left + BAR_WIDTH, 0.5 + half, BAR_WIDTH / 2)) {
      return true
    }
  }
  return false
}

/** Cor (não pré-multiplicada) no ponto normalizado (0..1), ou transparente fora do ícone. */
function sample(x: number, y: number): Rgba {
  if (!insideRoundedRect(x, y, 0.04, 0.04, 0.96, 0.96, 0.21)) return { r: 0, g: 0, b: 0, a: 0 }
  if (insideBar(x, y)) return { r: 255, g: 255, b: 255, a: 255 }
  const t = (y - 0.04) / 0.92
  return {
    r: TOP.r + (BOTTOM.r - TOP.r) * t,
    g: TOP.g + (BOTTOM.g - TOP.g) * t,
    b: TOP.b + (BOTTOM.b - TOP.b) * t,
    a: 255
  }
}

/** Pixels RGBA (não pré-multiplicados) de um quadrado `size` x `size`, com suavização 4x4. */
export function renderIconRgba(size: number): Buffer {
  const out = Buffer.alloc(size * size * 4)
  const count = SAMPLES * SAMPLES
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0
      let g = 0
      let b = 0
      let a = 0
      for (let sy = 0; sy < SAMPLES; sy++) {
        for (let sx = 0; sx < SAMPLES; sx++) {
          const color = sample(
            (px + (sx + 0.5) / SAMPLES) / size,
            (py + (sy + 0.5) / SAMPLES) / size
          )
          r += color.r * color.a
          g += color.g * color.a
          b += color.b * color.a
          a += color.a
        }
      }
      const offset = (py * size + px) * 4
      if (a > 0) {
        out[offset] = Math.round(r / a)
        out[offset + 1] = Math.round(g / a)
        out[offset + 2] = Math.round(b / a)
        out[offset + 3] = Math.round(a / count)
      }
    }
  }
  return out
}

function pngChunk(type: string, data: Buffer): Buffer {
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const checksum = Buffer.alloc(4)
  checksum.writeUInt32BE(crc32(body))
  return Buffer.concat([length, body, checksum])
}

export function encodePng(rgba: Buffer, size: number): Buffer {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(size, 0)
  header.writeUInt32BE(size, 4)
  header[8] = 8 // profundidade
  header[9] = 6 // RGBA
  const stride = size * 4
  const raw = Buffer.alloc((stride + 1) * size)
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride)
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0))
  ])
}

/** Imagem de um ICO no formato BMP (DIB): BGRA de baixo para cima mais a máscara AND. */
function encodeDib(rgba: Buffer, size: number): Buffer {
  const header = Buffer.alloc(40)
  header.writeUInt32LE(40, 0)
  header.writeInt32LE(size, 4)
  header.writeInt32LE(size * 2, 8)
  header.writeUInt16LE(1, 12)
  header.writeUInt16LE(32, 14)
  const pixels = Buffer.alloc(size * size * 4)
  for (let y = 0; y < size; y++) {
    const source = (size - 1 - y) * size * 4
    for (let x = 0; x < size; x++) {
      const from = source + x * 4
      const to = (y * size + x) * 4
      pixels[to] = rgba[from + 2] ?? 0
      pixels[to + 1] = rgba[from + 1] ?? 0
      pixels[to + 2] = rgba[from] ?? 0
      pixels[to + 3] = rgba[from + 3] ?? 0
    }
  }
  const maskStride = Math.ceil(size / 32) * 4
  return Buffer.concat([header, pixels, Buffer.alloc(maskStride * size)])
}

/** ICO com várias resoluções: BMP até 128 px (compatível com tudo) e PNG em 256 px. */
export function encodeIco(images: { size: number; rgba: Buffer }[]): Buffer {
  const encoded = images.map(({ size, rgba }) => ({
    size,
    data: size >= 256 ? encodePng(rgba, size) : encodeDib(rgba, size)
  }))
  const directory = Buffer.alloc(6 + encoded.length * 16)
  directory.writeUInt16LE(1, 2)
  directory.writeUInt16LE(encoded.length, 4)
  let offset = directory.length
  encoded.forEach(({ size, data }, index) => {
    const entry = 6 + index * 16
    directory[entry] = size >= 256 ? 0 : size
    directory[entry + 1] = size >= 256 ? 0 : size
    directory.writeUInt16LE(1, entry + 4)
    directory.writeUInt16LE(32, entry + 6)
    directory.writeUInt32LE(data.length, entry + 8)
    directory.writeUInt32LE(offset, entry + 12)
    offset += data.length
  })
  return Buffer.concat([directory, ...encoded.map((image) => image.data)])
}
