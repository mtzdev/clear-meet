import type { AiProvider } from '@shared/ai'
import type { ChatMessage } from '@shared/chat'
import { AI_MESSAGES, isAiError } from '../errors'
import type { TextHooks, TextRequest, TextResult } from '../text/types'

/** O que as Conversas usam do roteador de texto (permite testar sem rede). */
export interface ChatTextRouter {
  hasProvider(): boolean
  run(request: TextRequest, signal: AbortSignal, hooks?: TextHooks): Promise<TextResult>
}

export type AnswerOutcome =
  | { type: 'done'; message: ChatMessage }
  /** O usuário parou: `message` é o que já tinha chegado (`null` se nada). */
  | { type: 'stopped'; message: ChatMessage | null }
  | { type: 'error'; message: string }

export interface AnswerRun {
  router: ChatTextRouter
  request: TextRequest
  signal: AbortSignal
  messageId: string
  /** Acumula o texto que já chegou (a UI retoma por aqui ao reabrir a aba). */
  streamed: { text: string }
  onDelta(delta: string): void
  now(): number
  log(message: string): void
  /** Prefixo do log de falha. */
  logTag: string
}

function assistantMessage(
  run: AnswerRun,
  text: string,
  provider: AiProvider | undefined,
  model: string | undefined,
  stopped: boolean
): ChatMessage {
  return {
    id: run.messageId,
    role: 'assistant',
    text,
    createdAt: new Date(run.now()).toISOString(),
    ...(provider ? { provider } : {}),
    ...(model ? { model } : {}),
    ...(stopped ? { stopped: true } : {})
  }
}

/** Gera uma resposta pelo roteador, transmitindo os pedaços; nunca lança. */
export async function generateAnswer(run: AnswerRun): Promise<AnswerOutcome> {
  try {
    const result = await run.router.run(run.request, run.signal, {
      onDelta: (delta) => {
        run.streamed.text += delta
        run.onDelta(delta)
      }
    })
    if (result.text.trim() === '') return { type: 'error', message: AI_MESSAGES['bad-response'] }
    return {
      type: 'done',
      message: assistantMessage(run, result.text, result.provider, result.model, false)
    }
  } catch (error) {
    if (run.signal.aborted) {
      const partial = run.streamed.text.trim()
      return {
        type: 'stopped',
        message:
          partial === ''
            ? null
            : assistantMessage(run, run.streamed.text, undefined, undefined, true)
      }
    }
    run.log(`${run.logTag} falhou: ${isAiError(error) ? error.kind : 'erro desconhecido'}`)
    return { type: 'error', message: isAiError(error) ? error.message : AI_MESSAGES.unknown }
  }
}
