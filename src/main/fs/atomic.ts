import { randomBytes } from 'node:crypto'
import { open, rename, rm, statfs } from 'node:fs/promises'
import { dirname } from 'node:path'

const TRANSIENT_CODES = new Set(['EPERM', 'EBUSY', 'EACCES'])

function isTransient(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | undefined)?.code
  return code !== undefined && TRANSIENT_CODES.has(code)
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Repete `operation` enquanto falhar com erro transitório do Windows (EPERM/EBUSY/EACCES:
 * antivírus e indexador seguram arquivos e pastas por instantes). `delayMs` é o intervalo
 * base e cresce a cada tentativa. Outros erros e o esgotar das tentativas são relançados.
 */
export async function retryTransient<T>(
  operation: () => Promise<T>,
  attempts = 6,
  delayMs = 150
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await operation()
    } catch (error) {
      if (!isTransient(error) || attempt >= attempts) throw error
      await sleep(delayMs * attempt)
    }
  }
}

/** `rename` com novas tentativas (ver `retryTransient`). */
export function renameWithRetry(
  from: string,
  to: string,
  attempts = 6,
  delayMs = 150
): Promise<void> {
  return retryTransient(() => rename(from, to), attempts, delayMs)
}

/** `rm -f` com novas tentativas (ver `retryTransient`). */
export function removeWithRetry(
  path: string,
  options: { recursive?: boolean; attempts?: number; delayMs?: number } = {}
): Promise<void> {
  const { recursive = false, attempts = 6, delayMs = 150 } = options
  return retryTransient(() => rm(path, { force: true, recursive }), attempts, delayMs)
}

/**
 * Escrita atômica: grava num arquivo temporário ao lado do destino, força o flush no
 * disco e só então renomeia por cima. Quem lê vê sempre o arquivo antigo ou o novo, inteiro;
 * uma queda no meio da escrita não deixa o destino pela metade.
 */
export async function writeFileAtomic(path: string, data: string | Uint8Array): Promise<void> {
  const tmp = `${path}.${process.pid}-${randomBytes(4).toString('hex')}.tmp`
  try {
    const handle = await open(tmp, 'w')
    try {
      await handle.writeFile(data)
      await handle.sync()
    } finally {
      await handle.close()
    }
    await renameWithRetry(tmp, path)
  } catch (error) {
    await rm(tmp, { force: true }).catch(() => undefined)
    throw error
  }
}

/**
 * Bytes livres no volume que contém `dir`. Se a pasta ainda não existe, mede no ancestral
 * existente mais próximo (mesmo volume). `null` se não der para medir.
 */
export async function freeDiskBytes(dir: string): Promise<number | null> {
  let current = dir
  for (;;) {
    try {
      const stats = await statfs(current)
      const free = Number(stats.bavail) * Number(stats.bsize)
      return Number.isFinite(free) ? free : null
    } catch (error) {
      const parent = dirname(current)
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT' || parent === current) return null
      current = parent
    }
  }
}
