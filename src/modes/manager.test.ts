import { describe, expect, test } from 'vitest'
import { createModeManager } from './manager'
import { freeRoam } from './freeRoam'
import type { GameMode, ModeContext } from './types'

const ctx = {} as ModeContext

function spyMode(id: string, log: string[]): GameMode {
  return {
    id,
    name: id,
    Scene: () => null,
    Hud: () => null,
    onEnter: () => log.push(`enter:${id}`),
    onExit: () => log.push(`exit:${id}`),
  }
}

describe('ModeManager', () => {
  test('[R1-1] 自由逛街實作模式介面並為預設模式', () => {
    const manager = createModeManager(ctx)
    expect(manager.active()).toBe(freeRoam)
    expect(typeof freeRoam.Scene).toBe('function')
    expect(typeof freeRoam.Hud).toBe('function')
    expect(freeRoam.id).toBe('freeRoam')
  })

  test('建立時不觸發 onEnter，start 後才啟用，結束函式觸發 onExit', () => {
    const log: string[] = []
    const manager = createModeManager(ctx, spyMode('a', log))
    expect(log).toEqual([])
    const stop = manager.start()
    expect(log).toEqual(['enter:a'])
    stop()
    expect(log).toEqual(['enter:a', 'exit:a'])
  })

  test('[R1-2] 切換模式時先結束舊模式再啟用新模式，並通知訂閱者', () => {
    const log: string[] = []
    const a = spyMode('a', log)
    const b = spyMode('b', log)
    const manager = createModeManager(ctx, a)
    const stop = manager.start()
    let notified = 0
    manager.subscribe(() => notified++)
    manager.switchTo(b)
    expect(log).toEqual(['enter:a', 'exit:a', 'enter:b'])
    expect(manager.active()).toBe(b)
    expect(notified).toBe(1)
    manager.switchTo(b)
    expect(notified).toBe(1)
    stop()
    expect(log).toEqual(['enter:a', 'exit:a', 'enter:b', 'exit:b'])
  })

  test('未啟用時切換模式不觸發 onEnter／onExit', () => {
    const log: string[] = []
    const manager = createModeManager(ctx, spyMode('a', log))
    manager.switchTo(spyMode('b', log))
    expect(log).toEqual([])
  })
})
