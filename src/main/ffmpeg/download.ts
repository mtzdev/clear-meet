import { createWriteStream } from 'node:fs'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'

export interface DownloadProgress {
  receivedBytes: number
  /** `null` quando o servidor não informa o tamanho. */
  totalBytes: number | null
}

export interface DownloadOptions {
  fetch?: typeof fetch
  signal?: AbortSignal
  onProgress?: (progress: DownloadProgress) => void
}

/** Baixa `url` para `destPath` em streaming (sem carregar o arquivo na memória), com progresso. */
export async function downloadFile(
  url: string,
  destPath: string,
  options: DownloadOptions = {}
): Promise<DownloadProgress> {
  const fetchFn = options.fetch ?? fetch
  const response = await fetchFn(url, { signal: options.signal ?? null, redirect: 'follow' })
  if (!response.ok || !response.body) {
    throw new Error(`Falha no download (${response.status} ${response.statusText}): ${url}`)
  }

  const length = Number(response.headers.get('content-length'))
  const totalBytes = Number.isFinite(length) && length > 0 ? length : null
  let receivedBytes = 0

  const counter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      receivedBytes += chunk.length
      options.onProgress?.({ receivedBytes, totalBytes })
      callback(null, chunk)
    }
  })

  const source = Readable.fromWeb(response.body)
  await pipeline(source, counter, createWriteStream(destPath), {
    signal: options.signal as AbortSignal
  })

  if (totalBytes !== null && receivedBytes !== totalBytes) {
    throw new Error(`Download incompleto: ${receivedBytes} de ${totalBytes} bytes`)
  }
  return { receivedBytes, totalBytes }
}
