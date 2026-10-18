/**
 * Gera `build/icon.png` (1024 px) e `build/icon.ico` (16 a 256 px).
 *
 *   npm run make:icon
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { encodeIco, encodePng, ICO_SIZES, renderIconRgba } from './icon'

const buildDir = resolve(__dirname, '..', 'build')
mkdirSync(buildDir, { recursive: true })

const PNG_SIZE = 1024
writeFileSync(join(buildDir, 'icon.png'), encodePng(renderIconRgba(PNG_SIZE), PNG_SIZE))
writeFileSync(
  join(buildDir, 'icon.ico'),
  encodeIco(ICO_SIZES.map((size) => ({ size, rgba: renderIconRgba(size) })))
)
console.log(`Ícones gravados em ${buildDir}`)
