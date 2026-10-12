import { describe, expect, it } from 'vitest'
import { isMediaFileName, mediaUrl, parseMediaUrl } from './media'

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
