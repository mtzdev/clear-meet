import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FfmpegBuild } from './config'
import { extractZip } from './extract'
import { installFfmpeg, isInstalled, validateInstall, type InstallProgress } from './install'
import { ENCODERS_OUTPUT, VERSION_OUTPUT } from './probe-fixture'
import type { RunFn } from './probe'
import { ChecksumMismatchError } from './verify'
import { buildZip } from './zip-fixture'

const top = 'ffmpeg-9.0.2-full_build-shared'
const archive = buildZip({
  [`${top}/bin/ffmpeg.exe`]: 'fake ffmpeg',
  [`${top}/bin/ffprobe.exe`]: 'fake ffprobe',
  [`${top}/bin/ffplay.exe`]: 'fake ffplay',
  [`${top}/bin/avcodec-63.dll`]: 'fake dll',
  [`${top}/LICENSE`]: 'GPL',
  [`${top}/doc/readme.txt`]: 'docs'
})

function buildFor(zip: Buffer, overrides: Partial<FfmpegBuild> = {}): FfmpegBuild {
  return {
    version: '9.0.2',
    url: 'https://example.test/ffmpeg.zip',
    sha256: createHash('sha256').update(zip).digest('hex'),
    size: zip.length,
    ...overrides
  }
}

function fakeFetch(zip: Buffer, status = 200): typeof fetch {
  return vi.fn(() =>
    Promise.resolve(
      new Response(status === 200 ? new Uint8Array(zip) : null, {
        status,
        headers: { 'content-length': String(zip.length) }
      })
    )
  )
}

let root: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'clearmeet-install-'))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('installFfmpeg', () => {
  it('baixa, verifica, extrai só o necessário e move para <raiz>/<versão>', async () => {
    const build = buildFor(archive)
    const phases: string[] = []
    const validate = vi.fn((dir: string) => {
      // A validação roda antes do move, na pasta temporária.
      expect(existsSync(join(dir, 'ffmpeg.exe'))).toBe(true)
      expect(dir).not.toBe(join(root, '9.0.2'))
      return Promise.resolve()
    })

    const result = await installFfmpeg({
      destRoot: root,
      build,
      fetch: fakeFetch(archive),
      validate,
      onProgress: (p: InstallProgress) => {
        if (phases.at(-1) !== p.phase) phases.push(p.phase)
      }
    })

    expect(result).toEqual({ dir: join(root, '9.0.2'), installed: true })
    expect((await readdir(result.dir)).sort()).toEqual([
      'LICENSE.txt',
      'avcodec-63.dll',
      'ffmpeg.exe',
      'ffprobe.exe'
    ])
    expect(phases).toEqual(['download', 'verify', 'extract', 'validate', 'done'])
    expect(validate).toHaveBeenCalledOnce()
    expect(isInstalled(root, '9.0.2')).toBe(true)
    // Sem sobras temporárias.
    expect(await readdir(root)).toEqual(['9.0.2'])
  })

  it('não instala nada quando o SHA-256 não confere', async () => {
    const build = buildFor(archive, { sha256: '0'.repeat(64) })
    const validate = vi.fn(() => Promise.resolve())

    await expect(
      installFfmpeg({ destRoot: root, build, fetch: fakeFetch(archive), validate })
    ).rejects.toBeInstanceOf(ChecksumMismatchError)

    expect(validate).not.toHaveBeenCalled()
    expect(await readdir(root)).toEqual([])
  })

  it('não instala quando a validação falha', async () => {
    const build = buildFor(archive)
    await expect(
      installFfmpeg({
        destRoot: root,
        build,
        fetch: fakeFetch(archive),
        validate: () => Promise.reject(new Error('sem libsvtav1'))
      })
    ).rejects.toThrow('sem libsvtav1')
    expect(await readdir(root)).toEqual([])
  })

  it('falha em resposta HTTP de erro', async () => {
    const build = buildFor(archive)
    await expect(
      installFfmpeg({
        destRoot: root,
        build,
        fetch: fakeFetch(archive, 404),
        validate: () => Promise.resolve()
      })
    ).rejects.toThrow('404')
    expect(await readdir(root)).toEqual([])
  })

  it('falha se o pacote não tiver o ffprobe', async () => {
    const zip = buildZip({ [`${top}/bin/ffmpeg.exe`]: 'x' })
    await expect(
      installFfmpeg({
        destRoot: root,
        build: buildFor(zip),
        fetch: fakeFetch(zip),
        validate: () => Promise.resolve()
      })
    ).rejects.toThrow('ffprobe.exe')
    expect(await readdir(root)).toEqual([])
  })

  it('é idempotente: versão já instalada não baixa de novo, a menos que force', async () => {
    const build = buildFor(archive)
    const fetchMock = fakeFetch(archive)
    const validate = () => Promise.resolve()

    await installFfmpeg({ destRoot: root, build, fetch: fetchMock, validate })
    const again = await installFfmpeg({ destRoot: root, build, fetch: fetchMock, validate })
    expect(again.installed).toBe(false)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    const forced = await installFfmpeg({
      destRoot: root,
      build,
      fetch: fetchMock,
      validate,
      force: true
    })
    expect(forced.installed).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})

describe('validateInstall', () => {
  const runWith =
    (encoders: string): RunFn =>
    (_file, args) =>
      Promise.resolve({ stdout: args.includes('-encoders') ? encoders : VERSION_OUTPUT })

  it('aceita FFmpeg com libsvtav1 e ffprobe funcional', async () => {
    await expect(validateInstall(root, runWith(ENCODERS_OUTPUT))).resolves.toBeUndefined()
  })

  it('rejeita FFmpeg sem libsvtav1', async () => {
    const without = ENCODERS_OUTPUT.replace(/.*libsvtav1.*\n/, '')
    await expect(validateInstall(root, runWith(without))).rejects.toThrow('libsvtav1')
  })
})

describe('extractZip', () => {
  async function zipAt(
    name: string,
    entries: Record<string, string>
  ): Promise<{ zipPath: string; out: string }> {
    const zipPath = join(root, name)
    await writeFile(zipPath, buildZip(entries))
    const out = join(root, `out-${name}`)
    await mkdir(out)
    return { zipPath, out }
  }

  it('extrai só as entradas selecionadas, com o nome escolhido pelo seletor', async () => {
    const { zipPath, out } = await zipAt('ok.zip', { 'x/bin/a.dll': 'a', 'x/doc/b.txt': 'b' })
    const names = await extractZip(zipPath, out, (entry) =>
      entry.endsWith('.dll') ? 'a.dll' : null
    )
    expect(names).toEqual(['a.dll'])
    expect(await readdir(out)).toEqual(['a.dll'])
  })

  it('o próprio yauzl recusa entradas com ../ (zip-slip) e nada é escrito fora do destino', async () => {
    const { zipPath, out } = await zipAt('slip.zip', { '../evil.dll': 'x' })
    await expect(extractZip(zipPath, out, (entry) => entry)).rejects.toThrow(
      /invalid relative path/
    )
    expect(existsSync(join(root, 'evil.dll'))).toBe(false)
    expect(await readdir(out)).toEqual([])
  })

  it('rejeita seletor que devolve nome com diretório', async () => {
    const { zipPath, out } = await zipAt('dir.zip', { 'a/b.dll': 'x' })
    await expect(extractZip(zipPath, out, (entry) => entry)).rejects.toThrow('inválido')
    expect(await readdir(out)).toEqual([])
  })
})
