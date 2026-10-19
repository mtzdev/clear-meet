import { describe, expect, it } from 'vitest'
import type { FfmpegInstallState, FfmpegStatus } from '@shared/ffmpeg'
import { FfmpegInstaller, installErrorMessage, type FfmpegInstallerDeps } from './installer'
import { ChecksumMismatchError } from './verify'

const missing: FfmpegStatus = {
  available: false,
  source: null,
  ffmpegPath: null,
  ffprobePath: null,
  version: null,
  hasLibSvtAv1: false,
  pinnedVersion: '9.0.2',
  error: 'FFmpeg não instalado'
}
const ready: FfmpegStatus = { ...missing, available: true, error: null, source: 'downloaded' }

const successfulInstall: NonNullable<FfmpegInstallerDeps['install']> = (options) => {
  options.onProgress?.({ phase: 'download', receivedBytes: 10, totalBytes: 100 })
  options.onProgress?.({ phase: 'verify' })
  options.onProgress?.({ phase: 'extract' })
  options.onProgress?.({ phase: 'validate' })
  options.onProgress?.({ phase: 'done' })
  return Promise.resolve({ dir: 'C:\\x\\9.0.2', installed: true })
}

/** `statuses` são devolvidos em ordem; o último se repete. */
function setup(statuses: FfmpegStatus[], install = successfulInstall) {
  const events: FfmpegInstallState[] = []
  let installed = 0
  let clock = 0
  const queue = [...statuses]
  const installer = new FfmpegInstaller({
    destRoot: 'C:\\x',
    getStatus: () => Promise.resolve(queue.length > 1 ? queue.shift()! : queue[0]!),
    emit: (state) => events.push(state),
    onInstalled: () => void (installed += 1),
    install,
    now: () => (clock += 1000),
    log: () => undefined
  })
  return { installer, events, installedCount: () => installed }
}

describe('FfmpegInstaller', () => {
  it('instala quando não está disponível e termina pronto', async () => {
    const { installer, events, installedCount } = setup([missing, ready])
    expect(installer.start().phase).toBe('download')
    await installer.idle()
    expect(events.map((event) => event.phase)).toEqual([
      'download',
      'download',
      'verify',
      'extract',
      'validate',
      'done'
    ])
    expect(events[1]).toMatchObject({ receivedBytes: 10, totalBytes: 100 })
    expect(installer.getState()).toMatchObject({ phase: 'done', error: null })
    expect(installedCount()).toBe(1)
  })

  it('já disponível: não baixa nada', async () => {
    let calls = 0
    const { installer, installedCount } = setup([ready], () => {
      calls += 1
      return Promise.resolve({ dir: '', installed: false })
    })
    installer.start()
    await installer.idle()
    expect(calls).toBe(0)
    expect(installer.getState().phase).toBe('done')
    expect(installedCount()).toBe(0)
  })

  it('duas chamadas seguidas compartilham a mesma instalação', async () => {
    let calls = 0
    let release: () => void = () => undefined
    const gate = new Promise<void>((resolve) => (release = resolve))
    const { installer } = setup([missing, ready], async () => {
      calls += 1
      await gate
      return { dir: '', installed: true }
    })
    installer.start()
    installer.start()
    release()
    await installer.idle()
    expect(calls).toBe(1)
  })

  it('falha: mostra mensagem para o usuário e permite tentar de novo', async () => {
    let attempt = 0
    const { installer, events } = setup([missing, missing, ready], () => {
      attempt += 1
      return attempt === 1
        ? Promise.reject(new Error('fetch failed'))
        : Promise.resolve({ dir: '', installed: true })
    })
    installer.start()
    await installer.idle()
    expect(installer.getState().phase).toBe('error')
    expect(installer.getState().error).toContain('Verifique a conexão')
    expect(events.at(-1)?.phase).toBe('error')

    installer.start()
    await installer.idle()
    expect(installer.getState()).toMatchObject({ phase: 'done', error: null })
  })

  it('instalação que não passa na verificação final conta como erro', async () => {
    const { installer, installedCount } = setup([missing])
    installer.start()
    await installer.idle()
    expect(installer.getState().phase).toBe('error')
    expect(installedCount()).toBe(0)
  })
})

describe('installErrorMessage', () => {
  it('traduz os erros conhecidos e esconde o detalhe técnico', () => {
    expect(installErrorMessage(new ChecksumMismatchError('a', 'b'))).toContain('corrompido')
    expect(
      installErrorMessage(new Error('Falha no download (404 Not Found): https://x'))
    ).toContain('servidor')
    expect(installErrorMessage(new Error('ENOSPC: no space left'))).toContain('espaço')
    expect(installErrorMessage(new Error('qualquer coisa'))).toContain('conexão')
  })
})
