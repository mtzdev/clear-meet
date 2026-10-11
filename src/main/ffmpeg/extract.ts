import { createWriteStream } from 'node:fs'
import { join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import yauzl from 'yauzl'

/**
 * Extrai de um .zip só as entradas escolhidas por `select`, que devolve o nome do
 * arquivo de destino (plano, sem diretórios) ou `null` para ignorar a entrada.
 * O nome do arquivo no destino nunca vem do zip diretamente, o que evita zip-slip.
 * Devolve os nomes extraídos.
 */
export function extractZip(
  zipPath: string,
  destDir: string,
  select: (entryName: string) => string | null
): Promise<string[]> {
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true, autoClose: true }, (openError, zip) => {
      if (openError) return reject(openError)

      const extracted: string[] = []
      const fail = (error: unknown): void => {
        zip.close()
        reject(error instanceof Error ? error : new Error(String(error)))
      }

      zip.on('error', fail)
      zip.on('end', () => resolve(extracted))
      zip.on('entry', (entry: yauzl.Entry) => {
        if (entry.fileName.endsWith('/')) return zip.readEntry()
        const target = select(entry.fileName)
        if (target === null) return zip.readEntry()
        if (/[\\/]/.test(target) || target === '.' || target === '..') {
          return fail(new Error(`Destino inválido na extração: ${target}`))
        }
        zip.openReadStream(entry, (streamError, stream) => {
          if (streamError) return fail(streamError)
          pipeline(stream, createWriteStream(join(destDir, target))).then(() => {
            extracted.push(target)
            zip.readEntry()
          }, fail)
        })
      })
      zip.readEntry()
    })
  })
}
