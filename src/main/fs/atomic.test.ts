import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  freeDiskBytes,
  removeWithRetry,
  renameWithRetry,
  retryTransient,
  writeFileAtomic
} from './atomic'

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'clearmeet-atomic-'))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

function errno(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(code), { code })
}

describe('retryTransient', () => {
  it('repete em EPERM/EBUSY/EACCES até dar certo', async () => {
    for (const code of ['EPERM', 'EBUSY', 'EACCES']) {
      let calls = 0
      const result = await retryTransient(
        () => {
          calls++
          return calls < 3 ? Promise.reject(errno(code)) : Promise.resolve('ok')
        },
        6,
        1
      )
      expect(result).toBe('ok')
      expect(calls).toBe(3)
    }
  })

  it('desiste depois do número de tentativas e relança o erro', async () => {
    let calls = 0
    await expect(
      retryTransient(
        () => {
          calls++
          return Promise.reject(errno('EBUSY'))
        },
        3,
        1
      )
    ).rejects.toMatchObject({ code: 'EBUSY' })
    expect(calls).toBe(3)
  })

  it('não repete erros que não são transitórios', async () => {
    let calls = 0
    await expect(
      retryTransient(
        () => {
          calls++
          return Promise.reject(errno('ENOENT'))
        },
        6,
        1
      )
    ).rejects.toMatchObject({ code: 'ENOENT' })
    expect(calls).toBe(1)
  })
})

describe('writeFileAtomic', () => {
  it('cria e substitui o arquivo sem deixar temporários', async () => {
    const file = join(dir, 'meeting.json')
    await writeFileAtomic(file, 'um')
    expect(await readFile(file, 'utf8')).toBe('um')
    await writeFileAtomic(file, 'dois')
    expect(await readFile(file, 'utf8')).toBe('dois')
    expect(await readdir(dir)).toEqual(['meeting.json'])
  })

  it('se a escrita falha, o arquivo anterior continua intacto e não sobra temporário', async () => {
    const file = join(dir, 'meeting.json')
    await writeFileAtomic(file, 'original')
    // Pasta de destino inexistente: a escrita do temporário falha.
    await expect(writeFileAtomic(join(dir, 'sem', 'pasta', 'a.json'), 'novo')).rejects.toThrow()
    expect(await readFile(file, 'utf8')).toBe('original')
    expect(await readdir(dir)).toEqual(['meeting.json'])
  })

  it('várias escritas concorrentes terminam com um conteúdo inteiro de uma delas', async () => {
    const file = join(dir, 'c.json')
    await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        writeFileAtomic(file, `conteudo-${index}`.repeat(1000))
      )
    )
    const content = await readFile(file, 'utf8')
    expect(content).toMatch(/^(conteudo-\d)+$/)
    expect(new Set(content.match(/conteudo-\d/g)).size).toBe(1)
    expect(await readdir(dir)).toEqual(['c.json'])
  })
})

describe('renameWithRetry / removeWithRetry', () => {
  it('renomeia e remove', async () => {
    await writeFile(join(dir, 'a'), 'x')
    await renameWithRetry(join(dir, 'a'), join(dir, 'b'))
    expect(await readdir(dir)).toEqual(['b'])
    await removeWithRetry(join(dir, 'b'))
    await removeWithRetry(join(dir, 'nao-existe'))
    expect(await readdir(dir)).toEqual([])
  })
})

describe('freeDiskBytes', () => {
  it('mede o volume, mesmo se a pasta ainda não existe', async () => {
    const existing = await freeDiskBytes(dir)
    const missing = await freeDiskBytes(join(dir, 'ainda', 'nao', 'existe'))
    expect(existing).toBeGreaterThan(0)
    expect(missing).toBeGreaterThan(0)
  })
})
