import { AiError } from '../errors'
import type { TextBackend, TextHooks, TextRequest, TextResult } from './types'

export interface TextRouterDeps {
  groqKey(): string | null
  geminiKey(): string | null
  groqModel(): string
  geminiModel(): string
  createGroq(key: string): TextBackend
  createGemini(key: string): TextBackend
  log(message: string): void
}

const NO_KEY_MESSAGE = 'Configure a chave do Gemini ou da Groq nas Configurações.'

/** Falhas em que insistir no Gemini é inútil: sem rede ou cancelado pelo usuário. */
function staysWithError(error: AiError): boolean {
  return error.kind === 'cancelled' || error.kind === 'network'
}

/**
 * Escolhe o provedor do texto (Resumo e Conversa): a Groq quando há chave; se ela falhar por
 * qualquer motivo que não seja rede nem cancelamento (pedido grande demais, cota, indisponível,
 * chave ou modelo recusados), o Gemini assume, desde que não tenha começado a responder.
 */
export class TextRouter {
  constructor(private readonly deps: TextRouterDeps) {}

  hasProvider(): boolean {
    return this.deps.groqKey() !== null || this.deps.geminiKey() !== null
  }

  async run(request: TextRequest, signal: AbortSignal, hooks: TextHooks = {}): Promise<TextResult> {
    const groqKey = this.deps.groqKey()
    const geminiKey = this.deps.geminiKey()
    if (!groqKey && !geminiKey) throw new AiError('invalid-key', NO_KEY_MESSAGE)

    let emitted = false
    const onDelta = hooks.onDelta
      ? (text: string): void => {
          emitted = true
          hooks.onDelta?.(text)
        }
      : undefined

    if (groqKey) {
      const model = this.deps.groqModel()
      try {
        const completion = await this.deps.createGroq(groqKey).run(model, request, signal, onDelta)
        return { ...completion, provider: 'groq', model }
      } catch (error) {
        if (!(error instanceof AiError) || staysWithError(error) || emitted) throw error
        if (!geminiKey) {
          throw new AiError(
            error.kind,
            `${error.message} Configure também a chave do Gemini para a IA tentar com ele.`,
            error.options
          )
        }
        this.deps.log(`[ia] Groq falhou (${error.kind}); usando o Gemini`)
      }
    }
    return this.runGemini(geminiKey as string, request, signal, onDelta)
  }

  private async runGemini(
    key: string,
    request: TextRequest,
    signal: AbortSignal,
    onDelta: ((text: string) => void) | undefined
  ): Promise<TextResult> {
    const model = this.deps.geminiModel()
    const completion = await this.deps.createGemini(key).run(model, request, signal, onDelta)
    return { ...completion, provider: 'gemini', model }
  }
}
