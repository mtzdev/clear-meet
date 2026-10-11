import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'

/** Tamanho máximo do nome dentro do nome da pasta (o caminho todo no Windows tem limite de ~260). */
export const MAX_NAME_LENGTH = 80

const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i

/**
 * Deixa um texto seguro como parte de nome de pasta no Windows: troca caracteres
 * inválidos (`< > : " / \ | ? *` e de controle), tira pontos e espaços do fim, evita nomes
 * reservados (CON, NUL…) e limita o tamanho. Nunca devolve vazio (`fallback`).
 */
export function sanitizeName(name: string, fallback = 'Reunião'): string {
  const cleaned = name
    // eslint-disable-next-line no-control-regex -- caracteres de controle são inválidos em nomes no Windows
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_NAME_LENGTH)
    .replace(/[. ]+$/, '')
    .trim()
  if (cleaned === '' || RESERVED.test(cleaned)) return cleaned === '' ? fallback : `${cleaned}_`
  return cleaned
}

function pad(value: number, length = 2): string {
  return String(value).padStart(length, '0')
}

/** `2026-10-10 1430`: data e hora local, como no nome da pasta da Reunião. */
export function formatFolderStamp(date: Date): string {
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}${pad(date.getMinutes())}`
  )
}

/** `AAAA-MM-DD HHMM - Nome` (sem tratar colisão). */
export function meetingFolderBase(date: Date, name: string): string {
  return `${formatFolderStamp(date)} - ${sanitizeName(name)}`
}

/** `Reunião de 10/10 14:30`: nome sugerido para tela e para Reunião só de áudio. */
export function defaultMeetingName(date: Date): string {
  return (
    `Reunião de ${pad(date.getDate())}/${pad(date.getMonth() + 1)} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}`
  )
}

/** Nome sugerido: o título da janela gravada; para tela/só áudio, a data e hora. */
export function suggestMeetingName(
  source: { kind: 'screen' | 'window' | 'none'; name: string | null },
  date: Date
): string {
  const title = source.kind === 'window' ? source.name?.replace(/\s+/g, ' ').trim() : ''
  return title ? title.slice(0, MAX_NAME_LENGTH) : defaultMeetingName(date)
}

/** `base`, `base (2)`, `base (3)`… */
export function withSuffix(base: string, attempt: number): string {
  return attempt <= 1 ? base : `${base} (${attempt})`
}

/**
 * Cria a pasta da Reunião sem sobrescrever outra: `mkdir` sem `recursive` falha se
 * já existe (EEXIST), então a colisão é resolvida sem corrida entre verificar e criar.
 * Devolve o caminho criado.
 */
export async function createUniqueFolder(
  root: string,
  base: string,
  makeDir: (path: string) => Promise<unknown> = (path) => mkdir(path)
): Promise<string> {
  await mkdir(root, { recursive: true })
  for (let attempt = 1; attempt < 1000; attempt++) {
    const path = join(root, withSuffix(base, attempt))
    try {
      await makeDir(path)
      return path
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    }
  }
  throw new Error(`Não foi possível criar uma pasta livre para "${base}"`)
}
