import { describe, expect, it } from 'vitest'
import {
  isMediaFileName,
  mediaUrl,
  parseMediaUrl,
  parseThumbnailUrl,
  thumbnailFileName,
  thumbnailUrl
} from './media'

describe('mediaUrl / parseMediaUrl', () => {
  it('ida e volta, inclusive com espaços, acentos e símbolos no nome da pasta', () => {
    for (const folderName of [
      '2026-10-11 2034 - teste - Reuniao',
      '2026-10-10 1430 - Revisão #1 (final) & mais',
      'a'
    ]) {
      for (const file of ['video.mp4', 'audio.opus'] as const) {
        expect(parseMediaUrl(mediaUrl(folderName, file))).toEqual({ folderName, file })
      }
    }
  })

  it('usa o esquema clearmeet-media', () => {
    expect(mediaUrl('a b', 'video.mp4')).toBe('clearmeet-media://meeting/a%20b/video.mp4')
  })

  it('só aceita video.mp4 e audio.opus', () => {
    expect(isMediaFileName('video.mp4')).toBe(true)
    expect(isMediaFileName('meeting.json')).toBe(false)
    expect(parseMediaUrl('clearmeet-media://meeting/pasta/meeting.json')).toBeNull()
    expect(parseMediaUrl('clearmeet-media://meeting/pasta/video.part.mp4')).toBeNull()
    expect(parseMediaUrl('clearmeet-media://meeting/pasta/VIDEO.MP4')).toBeNull()
  })

  it('recusa path traversal e separadores no nome da pasta', () => {
    const bad = [
      'clearmeet-media://meeting/../video.mp4',
      'clearmeet-media://meeting/%2e%2e/video.mp4',
      'clearmeet-media://meeting/pasta/../audio.opus',
      'clearmeet-media://meeting/..%2F..%2Fsegredo/video.mp4',
      'clearmeet-media://meeting/..%5Csegredo/video.mp4',
      'clearmeet-media://meeting/C%3A/video.mp4',
      'clearmeet-media://meeting/%00/video.mp4',
      'clearmeet-media://meeting/pasta/sub/video.mp4',
      'clearmeet-media://meeting//video.mp4',
      'clearmeet-media://meeting/video.mp4',
      'clearmeet-media://meeting/pasta/'
    ]
    for (const url of bad) expect(parseMediaUrl(url), url).toBeNull()
  })

  it('recusa outro esquema, outro host e URLs malformadas', () => {
    expect(parseMediaUrl('file:///C:/Users/x/video.mp4')).toBeNull()
    expect(parseMediaUrl('https://meeting/pasta/video.mp4')).toBeNull()
    expect(parseMediaUrl('clearmeet-media://outro/pasta/video.mp4')).toBeNull()
    expect(parseMediaUrl('clearmeet-media://meeting/%E0%A4%A/video.mp4')).toBeNull()
    expect(parseMediaUrl('não é uma url')).toBeNull()
    expect(parseMediaUrl('')).toBeNull()
  })
})

describe('miniaturas', () => {
  it('ida e volta com o id da Reunião', () => {
    const id = '96596920-647a-478a-8e80-4c900b981419'
    expect(thumbnailUrl(id, 1234)).toBe(`clearmeet-media://thumbnail/${id}.jpg?v=1234`)
    expect(parseThumbnailUrl(thumbnailUrl(id, 1234))).toBe(`${id}.jpg`)
  })

  it('sanea ids estranhos para um nome de arquivo simples', () => {
    expect(thumbnailFileName('../../x y')).toBe('______x_y.jpg')
    expect(thumbnailFileName('')).toBe('_.jpg')
    expect(thumbnailFileName('a'.repeat(200))).toHaveLength(84)
    expect(parseThumbnailUrl(thumbnailUrl('a/b\\c', 1))).toBe('a_b_c.jpg')
  })

  it('recusa outros hosts, caminhos e extensões', () => {
    const bad = [
      'clearmeet-media://meeting/abc.jpg',
      'clearmeet-media://thumbnail/abc.png',
      'clearmeet-media://thumbnail/%2e%2e%2fabc.jpg',
      'clearmeet-media://thumbnail/a/b.jpg',
      'clearmeet-media://thumbnail/',
      'clearmeet-media://thumbnail/a%5Cb.jpg',
      'https://thumbnail/abc.jpg',
      'não é url'
    ]
    for (const url of bad) expect(parseThumbnailUrl(url)).toBeNull()
  })

  it('a URL de mídia da Reunião não aceita o host das miniaturas', () => {
    expect(parseMediaUrl('clearmeet-media://thumbnail/pasta/video.mp4')).toBeNull()
  })
})
