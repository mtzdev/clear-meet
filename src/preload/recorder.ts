import { contextBridge, ipcRenderer } from 'electron'
import {
  RECORDER_CHANNELS,
  type RecorderBridge,
  type RecorderCommandMessage
} from '@shared/recorder'

/** Ponte da janela de gravação (oculta): recebe comandos do main e devolve respostas, pedaços e eventos. */
const bridge: RecorderBridge = {
  onCommand(handler) {
    ipcRenderer.on(RECORDER_CHANNELS.command, (_event, message: RecorderCommandMessage) =>
      handler(message)
    )
  },
  reply(reply) {
    ipcRenderer.send(RECORDER_CHANNELS.reply, reply)
  },
  sendChunk(kind, data) {
    return ipcRenderer.invoke(RECORDER_CHANNELS.chunk, kind, data) as Promise<void>
  },
  sendEvent(event) {
    ipcRenderer.send(RECORDER_CHANNELS.event, event)
  }
}

contextBridge.exposeInMainWorld('recorderBridge', bridge)
