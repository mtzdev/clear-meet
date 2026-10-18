export interface ShortcutRegistry {
  register(accelerator: string, callback: () => void): boolean
  isRegistered(accelerator: string): boolean
  unregister(accelerator: string): void
}

/**
 * Descobre se o atalho está livre: tenta registrá-lo e o libera em seguida. Só vale fora da
 * gravação, quando o app não tem atalho global registrado.
 */
export function isShortcutAvailable(registry: ShortcutRegistry, accelerator: string): boolean {
  try {
    const registered =
      registry.register(accelerator, () => undefined) && registry.isRegistered(accelerator)
    if (registered) registry.unregister(accelerator)
    return registered
  } catch {
    return false
  }
}
