import type { RecorderBridge } from '@shared/recorder'

/**
 * `MediaStreamTrackProcessor` (Insertable Streams for MediaStreamTrack) ainda não está no
 * `lib.dom` do TypeScript. O Chromium do Electron o expõe na janela principal.
 */
declare global {
  class MediaStreamTrackProcessor {
    constructor(init: { track: MediaStreamTrack })
    readonly readable: ReadableStream<VideoFrame>
  }

  interface Window {
    /** Ponte tipada exposta pelo preload da janela de gravação. */
    recorderBridge: RecorderBridge
  }
}
