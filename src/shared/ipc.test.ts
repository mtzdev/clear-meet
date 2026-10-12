import { describe, expect, expectTypeOf, it } from 'vitest'
import type { FfmpegStatus } from './ffmpeg'
import {
  IPC_CHANNELS,
  IPC_EVENTS,
  isIpcChannel,
  isIpcEvent,
  type IpcInvokeArgs,
  type IpcResponse,
  type RendererApi,
  type VoidChannel
} from './ipc'
import type { Result, StartRecordingRequest } from './recording'

describe('contrato de IPC', () => {
  it('reconhece só canais declarados', () => {
    expect(isIpcChannel('app:getVersion')).toBe(true)
    expect(isIpcChannel('ffmpeg:status')).toBe(true)
    expect(isIpcChannel('fs:readFile')).toBe(false)
    expect(isIpcChannel('toString')).toBe(false)
    expect(isIpcChannel(undefined)).toBe(false)
  })

  it('lista de canais em runtime espelha o contrato', () => {
    expect(Object.keys(IPC_CHANNELS).sort()).toEqual([
      'app:getVersion',
      'capture:listSources',
      'ffmpeg:status',
      'floating:getInfo',
      'floating:resize',
      'floating:showMain',
      'meeting:addNote',
      'meeting:deleteNote',
      'meeting:get',
      'meeting:rename',
      'meeting:reveal',
      'meeting:updateNote',
      'meetings:list',
      'notes:begin',
      'notes:cancel',
      'notes:openEditor',
      'notes:save',
      'recording:acknowledge',
      'recording:getState',
      'recording:pause',
      'recording:preflight',
      'recording:resume',
      'recording:start',
      'recording:stop',
      'recovery:getReport',
      'recovery:retry',
      'settings:get',
      'settings:update'
    ])
  })

  it('tipos de pedido e resposta', () => {
    expectTypeOf<IpcResponse<'app:getVersion'>>().toEqualTypeOf<string>()
    expectTypeOf<IpcResponse<'ffmpeg:status'>>().toEqualTypeOf<FfmpegStatus>()
    expectTypeOf<IpcInvokeArgs<'app:getVersion'>>().toEqualTypeOf<[]>()
    expectTypeOf<IpcResponse<'recording:start'>>().toEqualTypeOf<Result<null>>()
    expectTypeOf<IpcInvokeArgs<'recording:start'>>().toEqualTypeOf<
      [request: StartRecordingRequest]
    >()
    expectTypeOf<IpcInvokeArgs<'recording:stop'>>().toEqualTypeOf<[]>()
    expectTypeOf<'app:getVersion'>().toExtend<VoidChannel>()
    expectTypeOf<'recording:start'>().not.toExtend<VoidChannel>()
  })

  it('reconhece só eventos declarados', () => {
    expect(isIpcEvent('recording:state')).toBe(true)
    expect(isIpcEvent('app:getVersion')).toBe(false)
    expect(Object.keys(IPC_EVENTS).sort()).toEqual([
      'floating:info',
      'notes:opened',
      'notes:saved',
      'recording:level',
      'recording:state',
      'recovery:report'
    ])
  })

  it('invoke rejeita canal desconhecido em tempo de compilação', () => {
    const api = null as unknown as RendererApi
    const never = (): void => {
      // @ts-expect-error canal inexistente no contrato
      void api.invoke('nao:existe')
      // @ts-expect-error 'app:getVersion' não recebe argumentos
      void api.invoke('app:getVersion', 'extra')
      // @ts-expect-error evento inexistente no contrato
      void api.on('nao:existe', () => undefined)
    }
    expect(never).toBeTypeOf('function')
  })
})
