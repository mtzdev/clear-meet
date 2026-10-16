import { describe, expect, it } from 'vitest'
import { readSse, SseDecoder } from './sse'

describe('SseDecoder', () => {
  it('separa eventos por linha em branco, com LF ou CRLF', () => {
    const decoder = new SseDecoder()
    expect(decoder.push('data: a\n\ndata: b\r\n\r\n')).toEqual(['a', 'b'])
  })

  it('junta um evento partido entre pedaços, inclusive no meio do separador', () => {
    const decoder = new SseDecoder()
    expect(decoder.push('data: {"x"')).toEqual([])
    expect(decoder.push(':1}\n')).toEqual([])
    expect(decoder.push('\ndata: segundo\n\n')).toEqual(['{"x":1}', 'segundo'])
  })

  it('ignora comentários e campos que não são data; várias linhas data viram uma carga', () => {
    const decoder = new SseDecoder()
    expect(decoder.push(': ping\n\nevent: msg\nid: 3\ndata: um\ndata: dois\n\n')).toEqual([
      'um\ndois'
    ])
  })

  it('flush entrega o último evento sem a linha em branco final', () => {
    const decoder = new SseDecoder()
    expect(decoder.push('data: final')).toEqual([])
    expect(decoder.flush()).toEqual(['final'])
    expect(decoder.flush()).toEqual([])
  })
})

describe('readSse', () => {
  it('lê o corpo da resposta inteiro, com caracteres multibyte cortados entre pedaços', async () => {
    const bytes = new TextEncoder().encode('data: ação\n\ndata: fim\n\n')
    const cut = bytes.indexOf(0xc3) + 1 // no meio do "ç"
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.slice(0, cut))
        controller.enqueue(bytes.slice(cut))
        controller.close()
      }
    })
    const received: string[] = []
    await readSse(new Response(stream), (data) => received.push(data))
    expect(received).toEqual(['ação', 'fim'])
  })

  it('resposta sem corpo é "bad-response"', async () => {
    await expect(readSse(new Response(null), () => undefined)).rejects.toMatchObject({
      kind: 'bad-response'
    })
  })
})
