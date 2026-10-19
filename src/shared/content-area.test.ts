import { describe, expect, it } from 'vitest'
import {
  areaMatchesFrame,
  cropFilter,
  decideContentArea,
  isContentArea,
  parseCropdetect
} from './content-area'

const FRAME = { width: 1920, height: 1080 }
const sample = (width: number, height: number, x: number, y: number) => ({ width, height, x, y })

describe('parseCropdetect', () => {
  it('pega a última medida (o cropdetect acumula)', () => {
    const output = [
      '[Parsed_cropdetect_0 @ 000] x1:277 x2:1642 y1:156 y2:923 w:1364 h:768 x:278 y:156 pts:0 crop=1364:768:278:156',
      '[Parsed_cropdetect_0 @ 000] x1:270 x2:1650 y1:156 y2:923 w:1376 h:768 x:272 y:156 pts:1 crop=1376:768:272:156'
    ].join('\n')
    expect(parseCropdetect(output)).toEqual({ width: 1376, height: 768, x: 272, y: 156 })
  })

  it('sem medida, nulo', () => {
    expect(parseCropdetect('nada aqui')).toBeNull()
    expect(parseCropdetect('crop=0:0:0:0')).toBeNull()
  })
})

describe('decideContentArea', () => {
  it('aceita amostras que concordam e devolve a união com folga, em medidas pares', () => {
    const area = decideContentArea(
      [
        sample(1364, 768, 278, 156),
        sample(1358, 768, 284, 156),
        sample(1364, 768, 278, 156),
        sample(1364, 768, 278, 156),
        sample(1364, 768, 278, 156)
      ],
      FRAME.width,
      FRAME.height
    )
    expect(area).toEqual({
      x: 276,
      y: 154,
      width: 1368,
      height: 772,
      frameWidth: 1920,
      frameHeight: 1080
    })
    expect(area!.width % 2).toBe(0)
    expect(area!.height % 2).toBe(0)
  })

  it('tolera uma amostra inválida, mas não duas', () => {
    const good = sample(1364, 768, 278, 156)
    expect(decideContentArea([good, good, good, good, null], 1920, 1080)).not.toBeNull()
    expect(decideContentArea([good, good, good, null, null], 1920, 1080)).toBeNull()
  })

  it('amostras que divergem (conteúdo escuro numa delas) não cortam nada', () => {
    const good = sample(1364, 768, 278, 156)
    const dark = sample(400, 200, 700, 400)
    expect(decideContentArea([good, good, good, good, dark], 1920, 1080)).toBeNull()
  })

  it('quadro sem faixas não gera área', () => {
    const full = sample(1920, 1080, 0, 0)
    expect(decideContentArea([full, full, full, full, full], 1920, 1080)).toBeNull()
    const almost = sample(1904, 1080, 8, 0)
    expect(decideContentArea([almost, almost, almost, almost, almost], 1920, 1080)).toBeNull()
  })

  it('área minúscula é tratada como erro de detecção', () => {
    const tiny = sample(100, 60, 900, 500)
    expect(decideContentArea([tiny, tiny, tiny, tiny, tiny], 1920, 1080)).toBeNull()
  })

  it('faixas só em cima e embaixo também valem', () => {
    const wide = sample(1920, 800, 0, 140)
    const area = decideContentArea([wide, wide, wide, wide, wide], 1920, 1080)
    expect(area).toMatchObject({ x: 0, y: 138, width: 1920 })
    expect(area!.y + area!.height).toBeLessThanOrEqual(1080)
  })

  it('tamanho do quadro inválido, nulo', () => {
    const good = sample(1364, 768, 278, 156)
    expect(decideContentArea([good, good, good, good], 0, 0)).toBeNull()
  })
})

describe('utilidades', () => {
  const area = { x: 276, y: 154, width: 1368, height: 772, frameWidth: 1920, frameHeight: 1080 }

  it('monta o filtro crop', () => {
    expect(cropFilter(area)).toBe('crop=1368:772:276:154')
  })

  it('a área só vale para o mesmo tamanho de quadro', () => {
    expect(areaMatchesFrame(area, 1920, 1080)).toBe(true)
    expect(areaMatchesFrame(area, 1368, 772)).toBe(false)
  })

  it('valida o formato vindo do disco', () => {
    expect(isContentArea(area)).toBe(true)
    expect(isContentArea({ ...area, width: 0 })).toBe(false)
    expect(isContentArea({ ...area, x: 'a' })).toBe(false)
    expect(isContentArea(null)).toBe(false)
  })
})
