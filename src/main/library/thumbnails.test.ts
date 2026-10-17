import { mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { FfmpegTools, ProcessResult, RunProcess } from '../ffmpeg/media'
import {
  frameOffsetMs,
  removeOrphanThumbnails,
  ThumbnailQueue,
  thumbnailPath,
  type ThumbnailJob,
  type ThumbnailOutcome
} from './thumbnails'

const tools: FfmpegTools = { ffmpegPath: 'ffmpeg', ffprobePath: 'ffprobe' }
const ok: ProcessResult = { code: 0, stdout: '', stderr: '' }

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'clearmeet-thumbs-'))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

function job(id: string, overrides: Partial<ThumbnailJob> = {}): ThumbnailJob {
  return {
    id,
    videoPath: `C:\\v\\${id}\\video.mp4`,
    durationMs: 600_000,
    videoSig: '1:1',
    ...overrides
  }
}

interface Harness {
  queue: ThumbnailQueue
  calls: string[][]
  done: [string, ThumbnailOutcome][]
  allow: { value: boolean }
}

function harness(
  run: (args: string[]) => Promise<ProcessResult>,
  options: { tools?: FfmpegTools | null } = {}
): Harness {
  const calls: string[][] = []
  const done: [string, ThumbnailOutcome][] = []
  const allow = { value: true }
  const runner: RunProcess = (_file, args) => {
    calls.push(args)
    return run(args)
  }
  const queue = new ThumbnailQueue({
    dir,
    getTools: () => Promise.resolve(options.tools === undefined ? tools : options.tools),
    canRun: () => allow.value,
    onDone: (finished, outcome) => done.push([finished.id, outcome]),
    run: runner
  })
  return { queue, calls, done, allow }
}

/** FFmpeg de mentira: escreve o JPEG no último argumento. */
const writesJpeg = async (args: string[]): Promise<ProcessResult> => {
  await writeFile(args[args.length - 1] as string, 'JPEG')
  return ok
}

describe('frameOffsetMs', () => {
  it('~10% do Vídeo, 3 s sem duração, sempre dentro do Vídeo', () => {
    expect(frameOffsetMs(600_000)).toBe(60_000)
    expect(frameOffsetMs(null)).toBe(3000)
    expect(frameOffsetMs(0)).toBe(3000)
    expect(frameOffsetMs(1000)).toBe(100)
    expect(frameOffsetMs(400)).toBe(0)
  })
})

describe('ThumbnailQueue', () => {
  it('gera um JPEG de 320 px no cache, com o quadro em ~10% do Vídeo', async () => {
    const h = harness(writesJpeg)
    h.queue.enqueue([job('a')])
    await h.queue.idle()

    expect(h.done).toEqual([['a', 'ok']])
    expect(await readFile(thumbnailPath(dir, 'a'), 'utf8')).toBe('JPEG')
    const args = h.calls[0] as string[]
    expect(args.slice(args.indexOf('-ss'), args.indexOf('-ss') + 4)).toEqual([
      '-ss',
      '60.000',
      '-i',
      'C:\\v\\a\\video.mp4'
    ])
    expect(args).toContain('scale=320:-2')
    expect(args).toContain('-frames:v')
    // Nenhum temporário sobra no cache.
    expect(await readdir(dir)).toEqual(['a.jpg'])
  })

  it('processa uma de cada vez, na ordem em que foram enfileiradas', async () => {
    let running = 0
    let peak = 0
    const h = harness(async (args) => {
      running++
      peak = Math.max(peak, running)
      await new Promise((resolve) => setTimeout(resolve, 5))
      running--
      return writesJpeg(args)
    })
    h.queue.enqueue([job('a'), job('b'), job('c')])
    await h.queue.idle()
    expect(h.done.map(([id]) => id)).toEqual(['a', 'b', 'c'])
    expect(peak).toBe(1)
  })

  it('o mesmo Vídeo enfileirado duas vezes é gerado uma vez', async () => {
    const h = harness(writesJpeg)
    h.queue.enqueue([job('a'), job('a')])
    await h.queue.idle()
    expect(h.done).toHaveLength(1)
  })

  it('tenta o início do Vídeo quando o quadro de 10% não sai', async () => {
    const h = harness(async (args) => {
      if (args[args.indexOf('-ss') + 1] !== '0.000') return { ...ok, code: 1 }
      return writesJpeg(args)
    })
    h.queue.enqueue([job('a')])
    await h.queue.idle()
    expect(h.done).toEqual([['a', 'ok']])
    expect(h.calls).toHaveLength(2)
  })

  it('FFmpeg que falha marca a Reunião como falha e segue a fila', async () => {
    const h = harness(async (args) => {
      if (args.includes('C:\\v\\a\\video.mp4')) return { ...ok, code: 1, stderr: 'quebrou' }
      return writesJpeg(args)
    })
    h.queue.enqueue([job('a'), job('b')])
    await h.queue.idle()
    expect(h.done).toEqual([
      ['a', 'failed'],
      ['b', 'ok']
    ])
    await expect(stat(thumbnailPath(dir, 'a'))).rejects.toThrow()
  })

  it('exit 0 sem arquivo gerado também é falha', async () => {
    const h = harness(() => Promise.resolve(ok))
    h.queue.enqueue([job('a')])
    await h.queue.idle()
    expect(h.done).toEqual([['a', 'failed']])
  })

  it('não roda enquanto não pode (gravando) e retoma com kick()', async () => {
    const h = harness(writesJpeg)
    h.allow.value = false
    h.queue.enqueue([job('a')])
    await h.queue.idle()
    expect(h.done).toEqual([])
    expect(h.queue.size).toBe(1)

    h.allow.value = true
    h.queue.kick()
    await h.queue.idle()
    expect(h.done).toEqual([['a', 'ok']])
  })

  it('sem FFmpeg não faz nada e descarta a fila (a próxima varredura enfileira de novo)', async () => {
    const h = harness(writesJpeg, { tools: null })
    h.queue.enqueue([job('a'), job('b')])
    await h.queue.idle()
    expect(h.calls).toEqual([])
    expect(h.done).toEqual([])
    expect(h.queue.size).toBe(0)
  })

  it('remove(id) tira um trabalho pendente', async () => {
    const h = harness(writesJpeg)
    h.allow.value = false
    h.queue.enqueue([job('a'), job('b')])
    h.queue.remove('a')
    h.allow.value = true
    h.queue.kick()
    await h.queue.idle()
    expect(h.done).toEqual([['b', 'ok']])
  })
})

describe('removeOrphanThumbnails', () => {
  it('apaga o que não é de nenhuma Reunião, inclusive temporários', async () => {
    await writeFile(thumbnailPath(dir, 'fica'), 'x')
    await writeFile(thumbnailPath(dir, 'sai'), 'x')
    await writeFile(join(dir, 'fica.tmp.jpg'), 'x')
    await removeOrphanThumbnails(dir, ['fica'])
    expect(await readdir(dir)).toEqual(['fica.jpg'])
  })

  it('pasta de cache inexistente não é erro', async () => {
    await removeOrphanThumbnails(join(dir, 'nao-existe'), ['a'])
  })
})
