import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { MEETING_FILES } from '@shared/meeting'
import { parseMediaUrl, type MediaFileName } from '@shared/media'
import { isDirectChild } from '../meetings/repository'

/** Sem suporte a `Range` o player não faz seek no MP4. Qualquer caminho fora do permitido é 404. */

const CONTENT_TYPES: Record<MediaFileName, string> = {
  [MEETING_FILES.video]: 'video/mp4',
  [MEETING_FILES.audio]: 'audio/ogg; codecs=opus'
}

export type ByteRange = { start: number; end: number }

/**
 * Interpreta o cabeçalho `Range` (um único intervalo `bytes=a-b`, `bytes=a-` ou `bytes=-n`).
 * `null` = sem Range válido ou com vários intervalos (serve o arquivo inteiro);
 * `'unsatisfiable'` = fora do arquivo (416).
 */
export function parseRange(
  header: string | null,
  size: number
): ByteRange | 'unsatisfiable' | null {
  if (!header) return null
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (!match) return null
  const [, from = '', to = ''] = match
  if (from === '' && to === '') return null

  if (from === '') {
    const suffix = Number(to)
    if (suffix === 0 || size === 0) return 'unsatisfiable'
    return { start: Math.max(0, size - suffix), end: size - 1 }
  }
  const start = Number(from)
  if (start >= size) return 'unsatisfiable'
  const end = to === '' ? size - 1 : Math.min(Number(to), size - 1)
  if (end < start) return null
  return { start, end }
}

function plain(status: number, extra: Record<string, string> = {}): Response {
  return new Response(null, { status, headers: { 'X-Content-Type-Options': 'nosniff', ...extra } })
}

/**
 * Caminho em disco do arquivo pedido, ou `null` se a URL não é válida ou aponta para fora de
 * uma pasta de Reunião dentro de `root`.
 */
export function resolveMediaPath(root: string, url: string): string | null {
  const parsed = parseMediaUrl(url)
  if (!parsed) return null
  const folder = join(root, parsed.folderName)
  if (!isDirectChild(root, folder)) return null
  return join(folder, parsed.file)
}

export function createMediaHandler(getRoot: () => string): (request: Request) => Promise<Response> {
  return async (request) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') return plain(405)
    const path = resolveMediaPath(getRoot(), request.url)
    if (!path) return plain(404)

    let size: number
    try {
      const info = await stat(path)
      if (!info.isFile()) return plain(404)
      size = info.size
    } catch {
      return plain(404)
    }

    const parsed = parseMediaUrl(request.url)
    const type = parsed ? CONTENT_TYPES[parsed.file] : 'application/octet-stream'
    const headers: Record<string, string> = {
      'Content-Type': type,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff'
    }

    const range = parseRange(request.headers.get('range'), size)
    if (range === 'unsatisfiable') return plain(416, { 'Content-Range': `bytes */${size}` })

    const { start, end } = range ?? { start: 0, end: size - 1 }
    const length = size === 0 ? 0 : end - start + 1
    headers['Content-Length'] = String(length)
    if (range) headers['Content-Range'] = `bytes ${start}-${end}/${size}`
    const status = range ? 206 : 200

    if (request.method === 'HEAD' || length === 0) return new Response(null, { status, headers })

    const stream = createReadStream(path, { start, end })
    return new Response(Readable.toWeb(stream), { status, headers })
  }
}
