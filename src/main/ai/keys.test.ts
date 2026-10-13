import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { KEYS_FILE, KeyStore, type SecretBox } from './keys'

const GEMINI = 'AIzaSyDUMMY-gemini-key-0001'
const GROQ = 'gsk_dummy_groq_key_000000000001'

/** "Cifra" de brinquedo: o suficiente para provar que o arquivo não guarda a chave em texto puro. */
function fakeBox(available = true): SecretBox {
  return {
    isAvailable: () => available,
    encrypt: (text) => Buffer.from(`ENC:${Buffer.from(text).toString('base64')}`),
    decrypt: (data) => {
      const raw = data.toString()
      if (!raw.startsWith('ENC:')) throw new Error('não decifrável')
      return Buffer.from(raw.slice(4), 'base64').toString()
    }
  }
}

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'clearmeet-keys-'))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('KeyStore', () => {
  it('começa sem chaves', async () => {
    const store = new KeyStore(dir, fakeBox())
    await store.load()
    expect(store.status()).toEqual({
      encryptionAvailable: true,
      keys: {
        gemini: { configured: false, last4: null },
        groq: { configured: false, last4: null }
      }
    })
    expect(store.get('gemini')).toBeNull()
  })

  it('salva cifrado, só devolve os 4 últimos caracteres e sobrevive a reabrir', async () => {
    const store = new KeyStore(dir, fakeBox())
    expect(await store.set('gemini', `  ${GEMINI} `)).toEqual({ ok: true, value: null })
    expect(store.status().keys.gemini).toEqual({ configured: true, last4: '0001' })
    expect(JSON.stringify(store.status())).not.toContain(GEMINI)

    const onDisk = await readFile(join(dir, KEYS_FILE), 'utf8')
    expect(onDisk).not.toContain(GEMINI)

    const reopened = new KeyStore(dir, fakeBox())
    await reopened.load()
    expect(reopened.get('gemini')).toBe(GEMINI)
  })

  it('guarda as duas chaves e remove uma sem perder a outra', async () => {
    const store = new KeyStore(dir, fakeBox())
    await store.set('gemini', GEMINI)
    await store.set('groq', GROQ)
    await store.clear('gemini')

    const reopened = new KeyStore(dir, fakeBox())
    await reopened.load()
    expect(reopened.get('gemini')).toBeNull()
    expect(reopened.get('groq')).toBe(GROQ)

    await reopened.clear('groq')
    await expect(readFile(join(dir, KEYS_FILE))).rejects.toThrow()
  })

  it('sem armazenamento seguro não salva nada e avisa', async () => {
    const store = new KeyStore(dir, fakeBox(false))
    const result = await store.set('gemini', GEMINI)
    expect(result.ok).toBe(false)
    expect(store.status().encryptionAvailable).toBe(false)
    expect(store.get('gemini')).toBeNull()
    await expect(readFile(join(dir, KEYS_FILE))).rejects.toThrow()
  })

  it('recusa chave vazia ou com espaços no meio', async () => {
    const store = new KeyStore(dir, fakeBox())
    expect((await store.set('gemini', '   ')).ok).toBe(false)
    expect((await store.set('gemini', 'AIza com espaço no meio 1234')).ok).toBe(false)
  })

  it('arquivo ilegível (outro usuário do Windows) vale como sem chaves e não é apagado', async () => {
    await writeFile(join(dir, KEYS_FILE), 'lixo')
    const store = new KeyStore(dir, fakeBox())
    await store.load()
    expect(store.get('gemini')).toBeNull()
    expect(await readFile(join(dir, KEYS_FILE), 'utf8')).toBe('lixo')
  })
})
