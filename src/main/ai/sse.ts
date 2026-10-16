import { AI_MESSAGES, AiError } from './errors'

/** Separa um fluxo de Server-Sent Events em cargas `data:`, mesmo com eventos partidos entre pedaços. */
export class SseDecoder {
  private buffer = ''

  /** Devolve a carga de cada evento que ficou completo com este pedaço. */
  push(chunk: string): string[] {
    this.buffer += chunk
    const events: string[] = []
    for (;;) {
      const match = /\r?\n\r?\n/.exec(this.buffer)
      if (!match) break
      const raw = this.buffer.slice(0, match.index)
      this.buffer = this.buffer.slice(match.index + match[0].length)
      const data = eventData(raw)
      if (data !== null) events.push(data)
    }
    return events
  }

  /** Evento final sem a linha em branco de fechamento. */
  flush(): string[] {
    const data = eventData(this.buffer)
    this.buffer = ''
    return data === null ? [] : [data]
  }
}

function eventData(raw: string): string | null {
  const lines: string[] = []
  for (const line of raw.split(/\r?\n/)) {
    if (!line.startsWith('data:')) continue
    lines.push(line.slice(5).replace(/^ /, ''))
  }
  return lines.length > 0 ? lines.join('\n') : null
}

/** Lê o corpo da resposta como SSE e entrega cada carga a `onData`. Falhas de leitura sobem como vieram. */
export async function readSse(response: Response, onData: (data: string) => void): Promise<void> {
  if (!response.body) throw new AiError('bad-response', AI_MESSAGES['bad-response'])
  const reader = response.body.getReader()
  const text = new TextDecoder()
  const decoder = new SseDecoder()
  try {
    for (;;) {
      const { done, value } = (await reader.read()) as { done: boolean; value?: Uint8Array }
      if (done) break
      for (const data of decoder.push(text.decode(value, { stream: true }))) onData(data)
    }
    for (const data of decoder.push(text.decode())) onData(data)
    for (const data of decoder.flush()) onData(data)
  } catch (error) {
    await reader.cancel().catch(() => undefined)
    throw error
  }
}
