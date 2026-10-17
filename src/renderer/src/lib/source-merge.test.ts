import { describe, expect, it } from 'vitest'
import type { CaptureSourceInfo } from '@shared/recording'
import { knownThumbnails, mergeSources } from './source-merge'

const source = (id: string, patch: Partial<CaptureSourceInfo> = {}): CaptureSourceInfo => ({
  id,
  kind: 'window',
  name: id,
  minimized: false,
  thumbKey: `k-${id}`,
  thumbnail: `data:${id}`,
  appIcon: `icon:${id}`,
  ...patch
})

describe('mergeSources', () => {
  it('lista igual devolve a mesma referência', () => {
    const current = [source('a'), source('b')]
    const incoming = [
      source('a', { thumbnail: null, appIcon: null }),
      source('b', { thumbnail: null, appIcon: null })
    ]
    expect(mergeSources(current, incoming)).toBe(current)
  })

  it('reaproveita miniatura e ícone que o main não reenviou, só se a chave é a mesma', () => {
    const current = [source('a')]
    const same = mergeSources(current, [source('a', { thumbnail: null, appIcon: null })])
    expect(same[0]).toBe(current[0])
    const changed = mergeSources(current, [
      source('a', { thumbKey: 'novo', thumbnail: 'data:novo', appIcon: null })
    ])
    expect(changed[0]).toMatchObject({ thumbnail: 'data:novo', appIcon: 'icon:a' })
  })

  it('só o cartão que mudou ganha nova referência', () => {
    const current = [source('a'), source('b')]
    const next = mergeSources(current, [
      source('a', { thumbnail: null, appIcon: null }),
      source('b', { thumbKey: 'k2', thumbnail: 'data:b2', appIcon: null })
    ])
    expect(next).not.toBe(current)
    expect(next[0]).toBe(current[0])
    expect(next[1]).not.toBe(current[1])
  })

  it('mantém a ordem; janelas novas vão para o fim e as que sumiram saem', () => {
    const current = [source('a'), source('b'), source('c')]
    const next = mergeSources(current, [
      source('c', { thumbnail: null, appIcon: null }),
      source('d'),
      source('a', { thumbnail: null, appIcon: null })
    ])
    expect(next.map((item) => item.id)).toEqual(['a', 'c', 'd'])
  })

  it('minimizar tira a miniatura e marca a janela', () => {
    const current = [source('a')]
    const next = mergeSources(current, [
      source('a', { minimized: true, thumbKey: null, thumbnail: null, appIcon: null })
    ])
    expect(next[0]).toMatchObject({ minimized: true, thumbKey: null, thumbnail: null })
    expect(next[0]?.appIcon).toBe('icon:a')
  })
})

describe('knownThumbnails', () => {
  it('informa a chave de quem tem imagem e "" de quem não tem miniatura', () => {
    expect(
      knownThumbnails([
        source('a'),
        source('b', { thumbKey: null, thumbnail: null }),
        source('c', { thumbnail: null })
      ])
    ).toEqual({ a: 'k-a', b: '' })
  })
})
