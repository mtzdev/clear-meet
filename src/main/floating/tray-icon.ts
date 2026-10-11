/** Cor do ícone da bandeja: a mesma de `--record` (tokens.css, tema claro). */
const RECORD_COLOR = { r: 0xe1, g: 0x1d, b: 0x48 }

/**
 * Ícone da bandeja desenhado em código (o app ainda não tem arquivo de ícone): um disco
 * vermelho de gravação com borda suavizada, em BGRA com alfa pré-multiplicado (formato de
 * `nativeImage.createFromBitmap` no Windows).
 */
export function renderTrayIcon(size: number): Buffer {
  const buffer = Buffer.alloc(size * size * 4)
  const center = (size - 1) / 2
  const radius = size / 2 - 1.5
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const distance = Math.hypot(x - center, y - center)
      // 1 dentro do disco, caindo a 0 ao longo de 1 pixel na borda.
      const coverage = Math.min(1, Math.max(0, radius + 0.5 - distance))
      const offset = (y * size + x) * 4
      buffer[offset] = Math.round(RECORD_COLOR.b * coverage)
      buffer[offset + 1] = Math.round(RECORD_COLOR.g * coverage)
      buffer[offset + 2] = Math.round(RECORD_COLOR.r * coverage)
      buffer[offset + 3] = Math.round(255 * coverage)
    }
  }
  return buffer
}
