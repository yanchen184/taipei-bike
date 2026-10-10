// @vitest-environment jsdom
import { describe, expect, test } from 'vitest'
import { createKeyboard } from './input'

const key = (type: 'keydown' | 'keyup', code: string) => window.dispatchEvent(new KeyboardEvent(type, { code }))

describe('D1 步行（鍵盤）', () => {
  test('[D1-1] 按住的方向鍵與 Shift 轉成移動軸；每幀讀取沿用同一個物件', () => {
    const keyboard = createKeyboard()
    const detach = keyboard.attach(window, () => undefined)
    const first = keyboard.axes()
    expect(first).toEqual({ forward: 0, right: 0, run: false, handbrake: false })

    key('keydown', 'KeyW')
    key('keydown', 'KeyA')
    key('keydown', 'ShiftLeft')
    expect(keyboard.axes()).toBe(first)
    expect(keyboard.axes()).toEqual({ forward: 1, right: -1, run: true, handbrake: false })

    key('keyup', 'KeyW')
    key('keydown', 'ArrowDown')
    expect(keyboard.axes()).toEqual({ forward: -1, right: -1, run: true, handbrake: false })

    window.dispatchEvent(new Event('blur'))
    expect(keyboard.axes()).toEqual({ forward: 0, right: 0, run: false, handbrake: false })

    key('keydown', 'Space')
    detach()
    expect(keyboard.axes()).toEqual({ forward: 0, right: 0, run: false, handbrake: false })
    expect(keyboard.axes()).toBe(first)
  })
})
