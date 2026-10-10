import { describe, expect, test } from 'vitest'
import { generateCity } from './city'
import { lightState, type Light } from './lights'

const city = generateCity(1)
const ORDER: Light[] = ['green', 'yellow', 'red']
const STEPS: Record<Light, number> = { green: 80, yellow: 20, red: 100 }

describe('C2 紅綠燈', () => {
  test('[C2-1] 任何時刻同一路口的兩個方向不會同時是綠燈或黃燈', () => {
    for (const node of city.intersections) {
      for (let step = 0; step <= 600; step++) {
        const t = step / 10
        expect(lightState(node, 'ew', t) === 'red' || lightState(node, 'ns', t) === 'red').toBe(true)
      }
    }
  })

  test('[C2-2] 每個方向依序綠 8 秒、黃 2 秒、紅 10 秒循環', () => {
    for (const node of city.intersections) {
      for (const axis of ['ew', 'ns'] as const) {
        const runs: { light: Light; length: number }[] = []
        for (let step = 0; step < 800; step++) {
          const light = lightState(node, axis, step / 10 + 0.05)
          const last = runs.at(-1)
          if (last && last.light === light) runs[runs.length - 1] = { light, length: last.length + 1 }
          else runs.push({ light, length: 1 })
        }
        const full = runs.slice(1, -1)
        expect(full.length).toBeGreaterThanOrEqual(6)
        full.forEach((run, k) => {
          if (k > 0) {
            const prev = full[k - 1]!.light
            expect(run.light).toBe(ORDER[(ORDER.indexOf(prev) + 1) % 3])
          }
          expect(run.length).toBe(STEPS[run.light])
        })
      }
    }
  })
})
