import type { PlayerInput } from '../sim/player'
import type { Action } from './engine'

export type Axes = Omit<PlayerInput, 'cameraYaw'>

const ACTION_KEYS: Record<string, Action> = {
  KeyE: 'interact',
  KeyQ: 'callCar',
  KeyR: 'reset',
  KeyC: 'camera',
  KeyH: 'horn',
  KeyM: 'menu',
  Escape: 'close',
}

export interface Keyboard {
  /** 每次回傳同一個物件，內容隨按鍵更新；呼叫端不可保留或修改 */
  axes(): Readonly<Axes>
  /** 開始監聽鍵盤，回傳停止監聽的函式；單次動作鍵在按下時呼叫 onAction（不含自動重複） */
  attach(target: Window, onAction: (action: Action) => void): () => void
}

function isTyping(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
}

/** 追蹤按住的鍵並轉成移動軸 */
export function createKeyboard(): Keyboard {
  const held = new Set<string>()
  const pressed = (...codes: string[]) => codes.some((c) => held.has(c))
  // 每幀由 GameLoop 讀取，只在按鍵變動時重算，避免每幀配置新物件
  const axes: Axes = { forward: 0, right: 0, run: false, handbrake: false }
  const recompute = () => {
    axes.forward = (pressed('KeyW', 'ArrowUp') ? 1 : 0) - (pressed('KeyS', 'ArrowDown') ? 1 : 0)
    axes.right = (pressed('KeyD', 'ArrowRight') ? 1 : 0) - (pressed('KeyA', 'ArrowLeft') ? 1 : 0)
    axes.run = pressed('ShiftLeft', 'ShiftRight')
    axes.handbrake = pressed('Space')
  }
  const clear = () => {
    held.clear()
    recompute()
  }
  return {
    axes: () => axes,
    attach(target, onAction) {
      const down = (e: KeyboardEvent) => {
        if (isTyping(e.target)) return
        held.add(e.code)
        recompute()
        const action = ACTION_KEYS[e.code]
        if (action && !e.repeat) onAction(action)
        if (e.code === 'Space') e.preventDefault()
      }
      const up = (e: KeyboardEvent) => {
        held.delete(e.code)
        recompute()
      }
      target.addEventListener('keydown', down)
      target.addEventListener('keyup', up)
      target.addEventListener('blur', clear)
      return () => {
        target.removeEventListener('keydown', down)
        target.removeEventListener('keyup', up)
        target.removeEventListener('blur', clear)
        clear()
      }
    },
  }
}
