const DARK_QUERY = '(prefers-color-scheme: dark)'

/** Aplica o tema em `<html>`: classe `.dark` (tokens) e `color-scheme` (barras de rolagem, formulários). */
export function applyTheme(root: HTMLElement, dark: boolean): void {
  root.classList.toggle('dark', dark)
  root.style.colorScheme = dark ? 'dark' : 'light'
}

/**
 * Segue o tema do Windows (`prefers-color-scheme`, alimentado por `nativeTheme` no main).
 * Chamar antes do primeiro render para não piscar o tema errado.
 */
export function initTheme(): void {
  const query = window.matchMedia(DARK_QUERY)
  const root = document.documentElement
  applyTheme(root, query.matches)
  query.addEventListener('change', (event) => applyTheme(root, event.matches))
}
