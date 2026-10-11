import type { RecorderCommand, RecorderResults } from '@shared/recorder'
import { RecorderEngine } from './engine'
import { measureLimiter } from './mix'

const bridge = window.recorderBridge
const engine = new RecorderEngine(bridge)

async function run(command: RecorderCommand): Promise<RecorderResults[keyof RecorderResults]> {
  switch (command.name) {
    case 'start':
      return engine.start(command.params)
    case 'pause':
      return engine.pause()
    case 'resume':
      return engine.resume()
    case 'stop':
      return engine.stop()
    case 'limiter-check':
      return measureLimiter()
  }
}

bridge.onCommand(({ id, command }) => {
  run(command).then(
    (result) => bridge.reply({ id, ok: true, result }),
    (error: unknown) =>
      bridge.reply({ id, ok: false, error: error instanceof Error ? error.message : String(error) })
  )
})

bridge.sendEvent({ type: 'ready' })
