import { open, type FileHandle } from 'node:fs/promises'

/**
 * Escreve os pedaços de uma gravação no disco, na ordem em que chegam, sem acumulá-los em
 * memória (cada pedaço é gravado e solto). Os `write` são encadeados: um erro (disco
 * cheio, por exemplo) fica registrado e é relançado nas próximas chamadas e em `close`.
 */
export class PartWriter {
  private chain: Promise<void> = Promise.resolve()
  private failure: Error | null = null
  private _bytesWritten = 0
  private closed = false

  private constructor(
    private readonly handle: FileHandle,
    readonly path: string
  ) {}

  /** Abre (cria) o arquivo para escrita no fim. */
  static async open(path: string): Promise<PartWriter> {
    return new PartWriter(await open(path, 'a'), path)
  }

  get bytesWritten(): number {
    return this._bytesWritten
  }

  /** O primeiro erro de escrita, se houve. */
  get error(): Error | null {
    return this.failure
  }

  write(data: Uint8Array): Promise<void> {
    if (this.closed) return Promise.reject(new Error('PartWriter já fechado'))
    if (this.failure) return Promise.reject(this.failure)
    const task = this.chain.then(async () => {
      if (this.failure) throw this.failure
      try {
        await this.handle.write(data)
        this._bytesWritten += data.byteLength
      } catch (error) {
        this.failure = error instanceof Error ? error : new Error(String(error))
        throw this.failure
      }
    })
    this.chain = task.catch(() => undefined)
    return task
  }

  /** Espera as escritas pendentes e fecha o arquivo. Relança o erro de escrita, se houve. */
  async close(): Promise<void> {
    if (!this.closed) {
      this.closed = true
      await this.chain
      await this.handle.sync().catch(() => undefined)
      await this.handle.close()
    }
    if (this.failure) throw this.failure
  }
}
