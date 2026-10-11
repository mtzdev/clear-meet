import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '@shared/settings'
import {
  DEFAULT_MEETINGS_FOLDER,
  readVideoEncoderSync,
  resolveMeetingsDir,
  SETTINGS_FILE,
  SettingsStore
} from './store'

let userData: string
beforeEach(async () => {
  userData = await mkdtemp(join(tmpdir(), 'clearmeet-settings-'))
})
afterEach(async () => {
  await rm(userData, { recursive: true, force: true })
})

const documents = 'C:\\Users\\ana\\Documents'

describe('resolveMeetingsDir', () => {
  it('padrão: Documentos\\ClearMeet; configurada: a escolhida', () => {
    expect(resolveMeetingsDir(DEFAULT_SETTINGS, documents)).toBe(
      join(documents, DEFAULT_MEETINGS_FOLDER)
    )
    expect(
      resolveMeetingsDir({ ...DEFAULT_SETTINGS, meetingsDir: 'D:\\Reunioes' }, documents)
    ).toBe('D:\\Reunioes')
  })
})

describe('SettingsStore', () => {
  it('sem arquivo: usa os padrões', async () => {
    const store = new SettingsStore(userData, documents)
    expect(await store.load()).toEqual(DEFAULT_SETTINGS)
    expect(store.view().resolvedMeetingsDir).toBe(join(documents, 'ClearMeet'))
  })

  it('persiste as alterações e as relê em outra instância', async () => {
    const store = new SettingsStore(userData, documents)
    await store.load()
    const view = await store.update({ quality: '720p', micDeviceId: 'abc' })
    expect(view.quality).toBe('720p')

    const reopened = new SettingsStore(userData, documents)
    expect(await reopened.load()).toEqual({
      ...DEFAULT_SETTINGS,
      quality: '720p',
      micDeviceId: 'abc'
    })
    expect(await readdir(userData)).toEqual([SETTINGS_FILE]) // sem temporários
  })

  it('valida na leitura: campo inválido volta ao padrão', async () => {
    await writeFile(
      join(userData, SETTINGS_FILE),
      JSON.stringify({ quality: '16k', compaction: false, meetingsDir: 'E:\\Meus' })
    )
    const store = new SettingsStore(userData, documents)
    expect(await store.load()).toEqual({
      ...DEFAULT_SETTINGS,
      compaction: false,
      meetingsDir: 'E:\\Meus'
    })
  })

  it('arquivo corrompido: guarda uma cópia e volta aos padrões', async () => {
    await writeFile(join(userData, SETTINGS_FILE), '{ isto nao e json')
    const store = new SettingsStore(userData, documents)
    expect(await store.load()).toEqual(DEFAULT_SETTINGS)
    expect(await readFile(join(userData, 'settings.corrupt.json'), 'utf8')).toBe(
      '{ isto nao e json'
    )
  })

  it('alterações seguidas e rápidas não se atropelam', async () => {
    const store = new SettingsStore(userData, documents)
    await store.load()
    await Promise.all([
      store.update({ quality: '720p' }),
      store.update({ micDeviceId: 'x' }),
      store.update({ quality: 'native' })
    ])
    const reopened = new SettingsStore(userData, documents)
    expect(await reopened.load()).toMatchObject({ quality: 'native', micDeviceId: 'x' })
  })
})

describe('readVideoEncoderSync', () => {
  it('sem arquivo, inválido ou corrompido: software; com "hardware" no arquivo: hardware', async () => {
    expect(readVideoEncoderSync(userData)).toBe('software')
    await writeFile(join(userData, SETTINGS_FILE), '{ quebrado')
    expect(readVideoEncoderSync(userData)).toBe('software')
    await writeFile(join(userData, SETTINGS_FILE), JSON.stringify({ videoEncoder: 'gpu' }))
    expect(readVideoEncoderSync(userData)).toBe('software')
    await writeFile(join(userData, SETTINGS_FILE), JSON.stringify({ videoEncoder: 'hardware' }))
    expect(readVideoEncoderSync(userData)).toBe('hardware')
  })
})
