/**
 * Cor de fundo da janela por tema. O main usa estes valores para pintar a janela
 * antes do renderer carregar (sem "flash"); precisam ser iguais ao `--background`
 * de `src/renderer/src/styles/tokens.css` (há um teste que confere).
 */
export const WINDOW_BACKGROUND = {
  light: '#fafafb',
  dark: '#0e0f13'
} as const
