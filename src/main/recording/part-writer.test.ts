import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PartWriter } from './part-writer'

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'clearmeet-parts-'))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('PartWriter', () => {
  it('escreve os pedaços na ordem em que chegam e conta os bytes', async () => {
    const path = join(dir, 'audio.part.webm')
    const writer = await PartWriter.open(path)
    // Sem esperar cada um: a ordem tem de ser mantida mesmo assim.
    const writes = [1, 2, 3, 4, 5].map((n) => writer.write(new Uint8Array(1000).fill(n)))
    await Promise.all(writes)
    await writer.close()

    expect(writer.bytesWritten).toBe(5000)
    const content = await readFile(path)
    expect(content.length).toBe(5000)
    expect([content[0], content[1000], content[2000], content[3000], content[4000]]).toEqual([
      1, 2, 3, 4, 5
    ])
  })

  it('o conteúdo já está no disco antes de fechar (sobrevive a uma queda do processo)', async () => {
    const path = join(dir, 'video.part.mp4')
    const writer = await PartWriter.open(path)
    await writer.write(new Uint8Array([1, 2, 3]))
    expect((await readFile(path)).length).toBe(3)
    await writer.close()
  })

  it('continua o arquivo existente (abre para acrescentar)', async () => {
    const path = join(dir, 'x.part')
    const first = await PartWriter.open(path)
    await first.write(new Uint8Array([1, 2]))
    await first.close()
    const second = await PartWriter.open(path)
    await second.write(new Uint8Array([3]))
    await second.close()
    expect([...(await readFile(path))]).toEqual([1, 2, 3])
  })

  it('depois de fechado recusa novas escritas; fechar de novo é inofensivo', async () => {
    const writer = await PartWriter.open(join(dir, 'y.part'))
    await writer.close()
    await expect(writer.write(new Uint8Array([1]))).rejects.toThrow('fechado')
    await writer.close()
  })
})
