import { describe, expect, test } from 'vitest'
import { generateCity, isOnRoad } from './city'
import { circleHitsRect } from './collide'
import { CYCLE, lightState, type Light } from './lights'
import {
  MIN_GAP,
  STEP,
  VEHICLE_SPEC,
  buildRoutes,
  initTraffic,
  stepTraffic,
  trafficAt,
  vehiclePose,
  writeVehiclePos,
  type StopLine,
  type TrafficState,
} from './traffic'

const city = generateCity(5)
const routes = buildRoutes(city)

/** 沿路線由 a 往前到 b 的距離 */
const ahead = (a: number, b: number, length: number) => (b - a + length) % length

describe('C4 NPC 交通', () => {
  test('[C4-1] 給定 seed 與時間，NPC 汽機車的位置與朝向完全確定', () => {
    const a = trafficAt(city, 95.5)
    const b = trafficAt(generateCity(5), 95.5)
    expect(a).toEqual(b)
    expect(a.vehicles.map((v) => vehiclePose(routes, v))).toEqual(b.vehicles.map((v) => vehiclePose(routes, v)))
    expect(trafficAt(city, 10).vehicles).not.toEqual(a.vehicles)
  })

  test('[C4-2] NPC 遇紅燈或黃燈停在停止線前', () => {
    /** 找出這個路口方向第一次出現該燈號的整數步 */
    const stepWith = (stop: StopLine, light: Light): number => {
      for (let step = 0; step < CYCLE / STEP; step++) {
        if (lightState(stop.intersection, stop.axis, step * STEP) === light) return step
      }
      throw new Error(`no ${light}`)
    }
    const single = (r: number, s: number, step: number): TrafficState => ({
      step,
      t: step * STEP,
      vehicles: [{ id: 'v', kind: routes[r]!.kind, route: r, s, speed: VEHICLE_SPEC[routes[r]!.kind].speed }],
    })

    routes.forEach((route, r) => {
      for (const stop of route.stops) {
        for (const before of [0.2, 0]) {
          for (const light of ['red', 'yellow'] as const) {
            const v = stepTraffic(single(r, stop.s - before, stepWith(stop, light)), routes).vehicles[0]!
            expect(v.s).toBe(stop.s)
          }
          const go = stepTraffic(single(r, stop.s - before, stepWith(stop, 'green')), routes).vehicles[0]!
          expect(go.s).toBeGreaterThan(stop.s)
        }
      }
      const last = route.stops.at(-1)!
      const wrapStart = route.length - 0.1
      const wrapped = stepTraffic(single(r, wrapStart, stepWith(last, 'red')), routes).vehicles[0]!
      expect(wrapped.s).toBeCloseTo(wrapStart + wrapped.speed * STEP - route.length)
      expect(wrapped.s).toBeLessThan(route.stops[0]!.s)
    })

    let state = initTraffic(city)
    for (let n = 0; n < 60 / STEP; n++) {
      const next = stepTraffic(state, routes)
      next.vehicles.forEach((v, k) => {
        const prev = state.vehicles[k]!
        const route = routes[v.route]!
        for (const stop of route.stops) {
          const crossed = ahead(prev.s, stop.s, route.length) < ahead(prev.s, v.s, route.length)
          if (crossed) expect(lightState(stop.intersection, stop.axis, state.t)).toBe('green')
        }
      })
      state = next
    }
  })

  test('[C4-3] NPC 始終在車道內，不會進入建築物範圍', () => {
    let state = initTraffic(city)
    for (let n = 0; n < 40 / STEP; n++) {
      state = stepTraffic(state, routes)
      if (n % 10 !== 0) continue
      for (const v of state.vehicles) {
        const { pos } = vehiclePose(routes, v)
        expect(isOnRoad(city, pos)).toBe(true)
        expect(city.colliders.some((r) => circleHitsRect(pos, 0.8, r))).toBe(false)
      }
    }
  })

  test('[C4-4] 同車道前後 NPC 間距始終至少 6 m', () => {
    let state = initTraffic(city)
    for (let n = 0; n < 60 / STEP; n++) {
      state = stepTraffic(state, routes)
      routes.forEach((route, r) => {
        const onRoute = state.vehicles.filter((v) => v.route === r).map((v) => v.s).sort((a, b) => a - b)
        onRoute.forEach((s, k) => {
          const ahead = k + 1 < onRoute.length ? onRoute[k + 1]! : onRoute[0]! + route.length
          if (onRoute.length > 1) expect(ahead - s).toBeGreaterThanOrEqual(MIN_GAP - 1e-9)
        })
      })
    }
  })

  test('[C4-5] NPC 有汽車也有機車', () => {
    const kinds = new Set(initTraffic(city).vehicles.map((v) => v.kind))
    expect(kinds).toEqual(new Set(['car', 'scooter']))
  })
})

describe('writeVehiclePos', () => {
  test('寫入的位置與 vehiclePose 相同，且沿用傳入的物件', () => {
    const traffic = trafficAt(city, 37)
    const out = { x: 0, z: 0 }
    for (const v of traffic.vehicles) {
      writeVehiclePos(routes, v, out)
      expect(out).toEqual(vehiclePose(routes, v).pos)
    }
  })
})
