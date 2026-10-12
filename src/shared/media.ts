import { MEETING_FILES } from './meeting'

/**
 * Esquema próprio para o player ler os arquivos da Reunião: o renderer não acessa o disco, e
 * `file://` está fora da CSP. Forma: `clearmeet-media://meeting/<nome da pasta>/<arquivo>`.
 * O main só serve `video.mp4` e `audio.opus` de pastas dentro da pasta das Reuniões.
 */
export const MEDIA_SCHEME = 'clearmeet-media'
const MEDIA_HOST = 'meeting'

export const MEDIA_FILES = [MEETING_FILES.video, MEETING_FILES.audio] as const
export type MediaFileName = (typeof MEDIA_FILES)[number]

export function isMediaFileName(value: string): value is MediaFileName {
  return (MEDIA_FILES as readonly string[]).includes(value)
}

/** URL de um arquivo de mídia da Reunião (`folderName` é só o nome da pasta, não o caminho). */
export function mediaUrl(folderName: string, file: MediaFileName): string {
  return `${MEDIA_SCHEME}://${MEDIA_HOST}/${encodeURIComponent(folderName)}/${file}`
}

export interface ParsedMediaUrl {
  folderName: string
  file: MediaFileName
}

/** Um nome de pasta simples: sem separadores, `.`/`..`, unidade (`:`) nem caracteres de controle. */
function isPlainFolderName(name: string): boolean {
  // eslint-disable-next-line no-control-regex -- caracteres de controle nunca são válidos num nome
  return name !== '' && name !== '.' && name !== '..' && !/[\\/:\u0000-\u001f]/.test(name)
}

/**
 * Interpreta uma URL de mídia. Devolve `null` para qualquer coisa fora do formato: outro
 * esquema ou host, caminho com mais ou menos de dois segmentos, nome de pasta com separador
 * (inclusive `%2F`, `%5C`, `..`) ou arquivo que não seja `video.mp4` / `audio.opus`.
 */
export function parseMediaUrl(url: string): ParsedMediaUrl | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (parsed.protocol !== `${MEDIA_SCHEME}:` || parsed.hostname !== MEDIA_HOST) return null
  const segments = parsed.pathname.split('/')
  if (segments.length !== 3 || segments[0] !== '') return null
  let folderName: string
  let file: string
  try {
    folderName = decodeURIComponent(segments[1] ?? '')
    file = decodeURIComponent(segments[2] ?? '')
  } catch {
    return null
  }
  if (!isPlainFolderName(folderName) || !isMediaFileName(file)) return null
  return { folderName, file }
}
