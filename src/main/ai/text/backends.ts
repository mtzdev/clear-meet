import { groqTextModel } from '@shared/ai'
import type { GeminiClient } from '../gemini'
import type { OpenAiChatRequest, OpenAiCompatClient } from '../openai-compat'
import type { TextBackend, TextRequest } from './types'

/** Estrutura pedida à IA sem schema nativo (modelos que só garantem "JSON válido"). */
function withSchemaInstruction(system: string, json: NonNullable<TextRequest['json']>): string {
  return `${system}\n\nResponda somente com um objeto JSON (sem texto antes ou depois) que siga este JSON Schema:\n${JSON.stringify(json.schema)}`
}

export function groqBackend(client: OpenAiCompatClient): TextBackend {
  return {
    run(model, request, signal, onDelta) {
      const info = groqTextModel(model)
      const body: OpenAiChatRequest = {
        model,
        system: request.system,
        messages: request.messages,
        maxOutputTokens: request.maxOutputTokens
      }
      if (info?.reasoning) body.reasoningEffort = 'low'
      if (request.json) {
        if (info?.structured) {
          body.json = { name: request.json.name, schema: request.json.schema, strict: true }
        } else {
          body.json = 'object'
          body.system = withSchemaInstruction(request.system, request.json)
        }
      }
      return onDelta ? client.chatStream(body, onDelta, signal) : client.chat(body, signal)
    }
  }
}

export function geminiBackend(client: GeminiClient): TextBackend {
  return {
    run(model, request, signal, onDelta) {
      const last = request.messages[request.messages.length - 1]
      const history = request.messages.slice(0, -1).map((turn) => ({
        role: turn.role === 'assistant' ? ('model' as const) : ('user' as const),
        text: turn.content
      }))
      const body = {
        model,
        systemInstruction: request.system,
        history,
        parts: [{ text: last?.content ?? '' }],
        maxOutputTokens: request.maxOutputTokens,
        ...(request.json ? { jsonSchema: request.json.schema } : {})
      }
      return onDelta ? client.generateStream(body, onDelta, signal) : client.generate(body, signal)
    }
  }
}
