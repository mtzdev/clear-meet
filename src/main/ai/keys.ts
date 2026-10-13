import { mkdir, readFile, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { AI_PROVIDERS, normalizeApiKey, type AiProvider, type AiStatus } from '@shared/ai'
import type { Result } from '@shared/recording'
import { writeFileAtomic } from '../fs/atomic'

export const KEYS_FILE = 'ai-keys.bin'

/** Parte de `safeStorage` que usamos (permite testar sem Electron). */
export interface SecretBox {
  isAvailable(): boolean
  encrypt(text: string): Buffer
  decrypt(data: Buffer): string
}

type StoredKeys = Partial<Record<AiProvider, string>>

/**
 * Chaves de API cifradas com `safeStorage` (DPAPI no Windows), todas num só arquivo em
 * `userData`. Nunca vão para o `settings.json` nem para o renderer, e nunca são logadas.
 * Se a cifragem não está disponível, nada é salvo (não existe plano B em texto puro).
 */
export class KeyStore {
  private keys: StoredKeys = {}

  constructor(
    private readonly userDataDir: string,
    private readonly box: SecretBox
  ) {}

  private get file(): string {
    return join(this.userDataDir, KEYS_FILE)
  }

  /** Lê o arquivo. Ilegível (outro usuário do Windows, arquivo corrompido) = sem chaves, sem apagar nada. */
  async load(): Promise<void> {
    this.keys = {}
    if (!this.box.isAvailable()) return
    let data: Buffer
    try {
      data = await readFile(this.file)
    } catch {
      return
    }
    try {
      const raw = JSON.parse(this.box.decrypt(data)) as Record<string, unknown>
      for (const provider of AI_PROVIDERS) {
        const key = normalizeApiKey(raw[provider])
        if (key) this.keys[provider] = key
      }
    } catch {
      this.keys = {}
    }
  }

  status(): AiStatus {
    const entry = (provider: AiProvider): AiStatus['keys'][AiProvider] => {
      const key = this.keys[provider]
      return key ? { configured: true, last4: key.slice(-4) } : { configured: false, last4: null }
    }
    return {
      encryptionAvailable: this.box.isAvailable(),
      keys: { gemini: entry('gemini'), groq: entry('groq') }
    }
  }

  /** A chave em claro, só para uso dentro do main. */
  get(provider: AiProvider): string | null {
    return this.keys[provider] ?? null
  }

  async set(provider: AiProvider, rawKey: string): Promise<Result<null>> {
    const key = normalizeApiKey(rawKey)
    if (!key) {
      return fail('invalid-request', 'A chave está vazia ou tem espaços no meio. Copie-a inteira.')
    }
    if (!this.box.isAvailable()) {
      return fail(
        'unknown',
        'O Windows não tem o armazenamento seguro disponível, então a chave não foi salva.'
      )
    }
    return this.persist({ ...this.keys, [provider]: key })
  }

  async clear(provider: AiProvider): Promise<Result<null>> {
    if (!(provider in this.keys)) return { ok: true, value: null }
    const next = { ...this.keys }
    delete next[provider]
    return this.persist(next)
  }

  private async persist(next: StoredKeys): Promise<Result<null>> {
    try {
      if (Object.keys(next).length === 0) {
        await rm(this.file, { force: true })
      } else {
        await mkdir(dirname(this.file), { recursive: true })
        await writeFileAtomic(this.file, this.box.encrypt(JSON.stringify(next)))
      }
    } catch {
      return fail('unknown', 'Não foi possível salvar a chave no disco.')
    }
    this.keys = next
    return { ok: true, value: null }
  }
}

function fail(code: 'invalid-request' | 'unknown', message: string): Result<null> {
  return { ok: false, error: { code, message } }
}
