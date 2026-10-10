// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react'
import { useEffect } from 'react'
import { afterEach, describe, expect, test } from 'vitest'
import { createModeManager } from './manager'
import type { GameMode, ModeContext } from './types'
import { useActiveMode } from './useActiveMode'

afterEach(cleanup)

function trackedMode(id: string, mounted: Set<string>): GameMode {
  const part = (kind: string) =>
    function Part() {
      useEffect(() => {
        mounted.add(`${id}:${kind}`)
        return () => void mounted.delete(`${id}:${kind}`)
      }, [])
      return <div data-testid={`${id}-${kind}`} />
    }
  return { id, name: id, Scene: part('scene'), Hud: part('hud') }
}

describe('useActiveMode', () => {
  test('[R1-2] 切換模式後舊模式的場景與 HUD 卸載，新模式的掛上', () => {
    const mounted = new Set<string>()
    const a = trackedMode('a', mounted)
    const b = trackedMode('b', mounted)
    const manager = createModeManager({} as ModeContext, a)

    function Host() {
      const mode = useActiveMode(manager)
      return (
        <>
          <mode.Scene />
          <mode.Hud />
        </>
      )
    }

    render(<Host />)
    expect(screen.getByTestId('a-scene')).toBeTruthy()
    expect([...mounted].sort()).toEqual(['a:hud', 'a:scene'])

    act(() => manager.switchTo(b))
    expect(screen.queryByTestId('a-scene')).toBeNull()
    expect(screen.queryByTestId('a-hud')).toBeNull()
    expect(screen.getByTestId('b-hud')).toBeTruthy()
    expect([...mounted].sort()).toEqual(['b:hud', 'b:scene'])
  })

  test('元件卸載時結束目前模式', () => {
    const log: string[] = []
    const mode: GameMode = {
      id: 'a',
      name: 'a',
      Scene: () => null,
      Hud: () => null,
      onEnter: () => log.push('enter'),
      onExit: () => log.push('exit'),
    }
    const manager = createModeManager({} as ModeContext, mode)
    function Host() {
      useActiveMode(manager)
      return null
    }
    const view = render(<Host />)
    expect(log).toEqual(['enter'])
    view.unmount()
    expect(log).toEqual(['enter', 'exit'])
  })
})
