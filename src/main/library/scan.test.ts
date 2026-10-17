import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { scanFolder } from './scan'

let folder: string
beforeEach(async () => {
  folder = join(await mkdtemp(join(tmpdir(), 'clearmeet-scan-')), 'reuniao')
  await mkdir(folder)
  await writeFile(join(folder, 'meeting.json'), '{}')
  await writeFile(join(folder, 'video.mp4'), 'v'.repeat(100))
})
afterEach(async () => {
  await rm(join(folder, '..'), { recursive: true, force: true })
})

describe('scanFolder', () => {
  it('o Vídeo compactado em construção não muda a assinatura nem o tamanho da Reunião', async () => {
    const before = await scanFolder(folder)
    await writeFile(join(folder, 'video.compacting.mp4'), 'x'.repeat(5000))
    const during = await scanFolder(folder)
    expect(during?.signature).toBe(before?.signature)
    expect(during?.sizeBytes).toBe(before?.sizeBytes)
    expect(during?.files.has('video.compacting.mp4')).toBe(false)
  })

  it('trocar o video.mp4 muda a assinatura do Vídeo (a miniatura é refeita)', async () => {
    const before = await scanFolder(folder)
    await writeFile(join(folder, 'video.mp4'), 'v'.repeat(40))
    const after = await scanFolder(folder)
    expect(after?.videoSig).not.toBe(before?.videoSig)
    expect(after?.sizeBytes).toBe(before ? before.sizeBytes - 60 : -1)
  })
})
