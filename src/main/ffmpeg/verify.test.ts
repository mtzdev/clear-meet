import { createHash } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ChecksumMismatchError, sha256File, verifySha256 } from './verify'

let dir: string
let file: string
const content = Buffer.from('conteúdo de teste')
const expected = createHash('sha256').update(content).digest('hex')

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'clearmeet-verify-'))
  file = join(dir, 'arquivo.bin')
  await writeFile(file, content)
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('sha256', () => {
  it('calcula o SHA-256 de um arquivo', async () => {
    expect(await sha256File(file)).toBe(expected)
  })

  it('aceita o hash correto, em maiúsculas ou minúsculas', async () => {
    await expect(verifySha256(file, expected)).resolves.toBeUndefined()
    await expect(verifySha256(file, expected.toUpperCase())).resolves.toBeUndefined()
  })

  it('rejeita um hash diferente com ChecksumMismatchError', async () => {
    const wrong = '0'.repeat(64)
    const error = await verifySha256(file, wrong).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ChecksumMismatchError)
    expect((error as ChecksumMismatchError).actual).toBe(expected)
    expect((error as ChecksumMismatchError).expected).toBe(wrong)
  })
})
