import { describe, expect, it } from 'vitest'
import { isShortcutAvailable, type ShortcutRegistry } from './shortcut-check'

function fakeRegistry(taken: string[] = []): ShortcutRegistry & { active: Set<string> } {
  const active = new Set<string>()
  return {
    active,
    register: (accelerator) => {
      if (taken.includes(accelerator)) return false
      active.add(accelerator)
      return true
    },
    isRegistered: (accelerator) => active.has(accelerator),
    unregister: (accelerator) => void active.delete(accelerator)
  }
}

describe('isShortcutAvailable', () => {
  it('atalho livre: registra para testar e libera em seguida', () => {
    const registry = fakeRegistry()
    expect(isShortcutAvailable(registry, 'Ctrl+Alt+N')).toBe(true)
    expect(registry.active.size).toBe(0)
  })

  it('atalho em uso por outro programa: indisponível e nada fica registrado', () => {
    const registry = fakeRegistry(['Ctrl+Alt+N'])
    expect(isShortcutAvailable(registry, 'Ctrl+Alt+N')).toBe(false)
    expect(registry.active.size).toBe(0)
  })

  it('registro que lança erro conta como indisponível', () => {
    const registry: ShortcutRegistry = {
      register: () => {
        throw new Error('inválido')
      },
      isRegistered: () => false,
      unregister: () => undefined
    }
    expect(isShortcutAvailable(registry, 'x')).toBe(false)
  })
})
