const DARK_QUERY = '(prefers-color-scheme: dark)'

/**
 * Aplica o tema em `<html>`: classe `.dark` (tokens) e `color-scheme` (barras de rolagem,
 * formulários). `colorScheme: false` deixa o `color-scheme` de fora: janelas transparentes
 * (barra flutuante) precisam disso, senão o Chromium pinta o fundo da página de forma opaca.
 */
export function applyTheme(root: HTMLElement, dark: boolean, colorScheme = true): void {
  root.classList.toggle('dark', dark)
  if (colorScheme) root.style.colorScheme = dark ? 'dark' : 'light'
}

/**
 * Segue o tema do Windows (`prefers-color-scheme`, alimentado por `nativeTheme` no main).
 * Chamar antes do primeiro render para não piscar o tema errado.
 */
export function initTheme(options: { colorScheme?: boolean } = {}): void {
  const colorScheme = options.colorScheme ?? true
  const query = window.matchMedia(DARK_QUERY)
  const root = document.documentElement
  applyTheme(root, query.matches, colorScheme)
  query.addEventListener('change', (event) => applyTheme(root, event.matches, colorScheme))
}
