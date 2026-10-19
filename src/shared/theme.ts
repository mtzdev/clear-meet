/**
 * Cor de fundo da janela por tema. O main usa estes valores para pintar a janela
 * antes do renderer carregar (sem "flash"); precisam ser iguais ao `--background`
 * de `src/renderer/src/styles/tokens.css` (há um teste que confere).
 */
export const WINDOW_BACKGROUND = {
  light: '#fafafb',
  dark: '#0e0f13'
} as const

/** Escolha de tema do usuário: seguir o Windows (padrão) ou fixar claro/escuro. */
export const THEME_PREFERENCES = ['system', 'light', 'dark'] as const
export type ThemePreference = (typeof THEME_PREFERENCES)[number]

export const DEFAULT_THEME: ThemePreference = 'system'

export function isThemePreference(value: unknown): value is ThemePreference {
  return typeof value === 'string' && (THEME_PREFERENCES as readonly string[]).includes(value)
}
