import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'

export class ChecksumMismatchError extends Error {
  constructor(
    readonly expected: string,
    readonly actual: string
  ) {
    super(`SHA-256 diferente do esperado (esperado ${expected}, obtido ${actual})`)
    this.name = 'ChecksumMismatchError'
  }
}

export async function sha256File(path: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer)
  return hash.digest('hex')
}

/** Lança `ChecksumMismatchError` se o SHA-256 do arquivo não bater (comparação sem diferenciar maiúsculas). */
export async function verifySha256(path: string, expected: string): Promise<void> {
  const actual = await sha256File(path)
  if (actual !== expected.toLowerCase())
    throw new ChecksumMismatchError(expected.toLowerCase(), actual)
}
