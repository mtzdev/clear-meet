import type { AiProvider } from '@shared/ai'

export interface TextTurn {
  role: 'user' | 'assistant'
  content: string
}

export interface TextRequest {
  system: string
  /** Conversa até a última pergunta do usuário. */
  messages: TextTurn[]
  /** Saída estruturada: o objeto JSON que o schema descreve. */
  json?: { name: string; schema: object }
  maxOutputTokens: number
}

export interface TextCompletion {
  text: string
  truncated: boolean
}

export interface TextResult extends TextCompletion {
  /** Quem de fato respondeu (pode ser o Gemini mesmo com a chave da Groq configurada). */
  provider: AiProvider
  model: string
}

export interface TextHooks {
  /** Pedaços da resposta, na medida em que chegam; sem ele a resposta vem inteira. */
  onDelta?: (text: string) => void
}

/** Um provedor de texto: gera a resposta (aos poucos, se houver `onDelta`) com o modelo dado. */
export interface TextBackend {
  run(
    model: string,
    request: TextRequest,
    signal: AbortSignal,
    onDelta?: (text: string) => void
  ): Promise<TextCompletion>
}
