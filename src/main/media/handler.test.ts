import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, sep } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mediaUrl } from '@shared/media'
import { createMediaHandler, parseRange, resolveMediaPath } from './handler'

describe('parseRange', () => {
  it('sem cabeçalho ou com formato desconhecido serve o arquivo inteiro', () => {
    expect(parseRange(null, 100)).toBeNull()
    expect(parseRange('', 100)).toBeNull()
    expect(parseRange('items=0-5', 100)).toBeNull()
    expect(parseRange('bytes=0-5,10-20', 100)).toBeNull()
    expect(parseRange('bytes=-', 100)).toBeNull()
  })

  it('intervalo fechado, aberto e de sufixo', () => {
    expect(parseRange('bytes=0-9', 100)).toEqual({ start: 0, end: 9 })
    expect(parseRange('bytes=90-', 100)).toEqual({ start: 90, end: 99 })
    expect(parseRange('bytes=-10', 100)).toEqual({ start: 90, end: 99 })
    expect(parseRange('bytes=-500', 100)).toEqual({ start: 0, end: 99 })
  })

  it('limita o fim ao tamanho e recusa o que está fora do arquivo', () => {
    expect(parseRange('bytes=50-5000', 100)).toEqual({ start: 50, end: 99 })
    expect(parseRange('bytes=100-', 100)).toBe('unsatisfiable')
    expect(parseRange('bytes=-0', 100)).toBe('unsatisfiable')
    expect(parseRange('bytes=0-', 0)).toBe('unsatisfiable')
    expect(parseRange('bytes=20-10', 100)).toBeNull()
  })
})

let root: string
let outside: string
beforeEach(async () => {
  const base = await mkdtemp(join(tmpdir(), 'clearmeet-media-'))
  root = join(base, 'Reunioes')
  outside = join(base, 'fora')
  await mkdir(join(root, '2026-10-10 1430 - Reunião'), { recursive: true })
  await mkdir(outside)
  await writeFile(join(root, '2026-10-10 1430 - Reunião', 'video.mp4'), '0123456789')
  await writeFile(join(root, '2026-10-10 1430 - Reunião', 'audio.opus'), 'abcdef')
  await writeFile(join(root, '2026-10-10 1430 - Reunião', 'meeting.json'), '{"segredo":1}')
  await writeFile(join(outside, 'video.mp4'), 'FORA')
  await writeFile(join(root, 'video.mp4'), 'NA RAIZ')
})
afterEach(async () => {
  await rm(join(root, '..'), { recursive: true, force: true })
})

const FOLDER = '2026-10-10 1430 - Reunião'

describe('resolveMediaPath', () => {
  it('resolve video.mp4 e audio.opus dentro de uma pasta de Reunião', () => {
    expect(resolveMediaPath(root, mediaUrl(FOLDER, 'video.mp4'))).toBe(
      join(root, FOLDER, 'video.mp4')
    )
    expect(resolveMediaPath(root, mediaUrl(FOLDER, 'audio.opus'))).toBe(
      join(root, FOLDER, 'audio.opus')
    )
  })

  it('recusa traversal, outros arquivos e outros esquemas', () => {
    const bad = [
      'clearmeet-media://meeting/..%2Ffora/video.mp4',
      'clearmeet-media://meeting/%2e%2e/video.mp4',
      'clearmeet-media://meeting/..%5Cfora/video.mp4',
      'clearmeet-media://meeting/C%3A%5CWindows/video.mp4',
      `clearmeet-media://meeting/${encodeURIComponent(FOLDER)}/meeting.json`,
      `clearmeet-media://meeting/${encodeURIComponent(FOLDER)}/..%2Fmeeting.json`,
      `file:///${root.replace(/\\/g, '/')}/${FOLDER}/video.mp4`
    ]
    for (const url of bad) expect(resolveMediaPath(root, url), url).toBeNull()
  })
})

describe('resolveMediaPath: normalização da URL', () => {
  it('um ".." no caminho é resolvido pelo parser e nunca sai da pasta das Reuniões', () => {
    const resolved = resolveMediaPath(root, 'clearmeet-media://meeting/../fora/video.mp4')
    expect(resolved === null || resolved.startsWith(root + sep)).toBe(true)
  })
})

describe('createMediaHandler', () => {
  const handler = (): ReturnType<typeof createMediaHandler> => createMediaHandler(() => root)
  const get = (
    url: string,
    headers: Record<string, string> = {},
    method = 'GET'
  ): Promise<Response> => handler()(new Request(url, { method, headers }))

  it('serve o arquivo inteiro com Accept-Ranges e o tipo certo', async () => {
    const response = await get(mediaUrl(FOLDER, 'video.mp4'))
    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe('video/mp4')
    expect(response.headers.get('Accept-Ranges')).toBe('bytes')
    expect(response.headers.get('Content-Length')).toBe('10')
    expect(await response.text()).toBe('0123456789')

    const audio = await get(mediaUrl(FOLDER, 'audio.opus'))
    expect(audio.headers.get('Content-Type')).toContain('audio/ogg')
  })

  it('responde 206 com Content-Range para pedidos com Range (seek)', async () => {
    const response = await get(mediaUrl(FOLDER, 'video.mp4'), { Range: 'bytes=2-5' })
    expect(response.status).toBe(206)
    expect(response.headers.get('Content-Range')).toBe('bytes 2-5/10')
    expect(response.headers.get('Content-Length')).toBe('4')
    expect(await response.text()).toBe('2345')

    const tail = await get(mediaUrl(FOLDER, 'video.mp4'), { Range: 'bytes=7-' })
    expect(tail.status).toBe(206)
    expect(await tail.text()).toBe('789')
  })

  it('Range fora do arquivo é 416', async () => {
    const response = await get(mediaUrl(FOLDER, 'video.mp4'), { Range: 'bytes=50-60' })
    expect(response.status).toBe(416)
    expect(response.headers.get('Content-Range')).toBe('bytes */10')
  })

  it('HEAD devolve os cabeçalhos sem corpo', async () => {
    const response = await get(mediaUrl(FOLDER, 'video.mp4'), {}, 'HEAD')
    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Length')).toBe('10')
    expect(await response.text()).toBe('')
  })

  it('arquivo ausente, traversal e métodos de escrita não servem nada', async () => {
    expect((await get(mediaUrl('2026-01-01 0000 - Inexistente', 'video.mp4'))).status).toBe(404)
    expect((await get('clearmeet-media://meeting/..%2Ffora/video.mp4')).status).toBe(404)
    expect((await get('clearmeet-media://meeting/../fora/video.mp4')).status).toBe(404)
    expect(
      (await get(`clearmeet-media://meeting/${encodeURIComponent(FOLDER)}/meeting.json`)).status
    ).toBe(404)
    const post = await handler()(
      new Request(mediaUrl(FOLDER, 'video.mp4'), { method: 'POST', body: 'x' })
    )
    expect(post.status).toBe(405)
  })

  it('uma pasta no lugar do arquivo é 404', async () => {
    await mkdir(join(root, 'pasta-com-nome-de-arquivo', 'video.mp4'), { recursive: true })
    expect((await get(mediaUrl('pasta-com-nome-de-arquivo', 'video.mp4'))).status).toBe(404)
  })

  it('segue a pasta das Reuniões atual (muda em runtime)', async () => {
    let current = root
    const dynamic = createMediaHandler(() => current)
    const url = mediaUrl(FOLDER, 'video.mp4')
    expect((await dynamic(new Request(url))).status).toBe(200)
    current = outside
    expect((await dynamic(new Request(url))).status).toBe(404)
  })
})
