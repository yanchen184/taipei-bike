import type { Circle } from './collide'
import { CAR_LANE_OFFSET, ROAD_WIDTH, SCOOTER_LANE_OFFSET } from './city'
import { lightState } from './lights'
import { createRng, hashSeed } from './rng'
import type { Axis, CityMap, Intersection, Pose, Vec2 } from './types'

export type VehicleKind = 'car' | 'scooter'

export const STEP = 1 / 30
export const MIN_GAP = 6
const STOP_MARGIN = 1
const ACCEL = 4

/** radius 為碰撞圓半徑；circles 為碰撞圓沿車身的前後位置（m），汽車排三顆讓碰撞範圍貼齊 4.4 m 長的車身 */
export const VEHICLE_SPEC: Record<VehicleKind, { speed: number; halfLength: number; radius: number; circles: readonly number[] }> = {
  car: { speed: 11, halfLength: 2.2, radius: 0.95, circles: [-1.3, 0, 1.3] },
  scooter: { speed: 9.5, halfLength: 1, radius: 0.6, circles: [0] },
}

interface Segment {
  start: number
  length: number
  x: number
  z: number
  dx: number
  dz: number
  heading: number
}

export interface StopLine {
  s: number
  intersection: Intersection
  axis: Axis
}

/** 繞單一街廓順時針一圈的車道 */
export interface Route {
  id: string
  kind: VehicleKind
  length: number
  segments: Segment[]
  stops: StopLine[]
}

export interface Vehicle {
  id: string
  kind: VehicleKind
  route: number
  s: number
  speed: number
}

export interface TrafficState {
  step: number
  t: number
  vehicles: Vehicle[]
}

function findIntersection(city: CityMap, i: number, j: number): Intersection {
  const node = city.intersections.find((n) => n.i === i && n.j === j)
  if (!node) throw new Error(`missing intersection ${i},${j}`)
  return node
}

export function buildRoutes(city: CityMap): Route[] {
  const routes: Route[] = []
  for (const block of city.blocks) {
    for (const kind of ['car', 'scooter'] as const) {
      const d = ROAD_WIDTH / 2 - (kind === 'car' ? CAR_LANE_OFFSET : SCOOTER_LANE_OFFSET)
      const x0 = block.rect.minX - d
      const x1 = block.rect.maxX + d
      const z0 = block.rect.minZ - d
      const z1 = block.rect.maxZ + d
      const w = x1 - x0
      const h = z1 - z0
      const segments: Segment[] = [
        { start: 0, length: w, x: x0, z: z0, dx: 1, dz: 0, heading: Math.PI / 2 },
        { start: w, length: h, x: x1, z: z0, dx: 0, dz: 1, heading: 0 },
        { start: w + h, length: w, x: x1, z: z1, dx: -1, dz: 0, heading: -Math.PI / 2 },
        { start: 2 * w + h, length: h, x: x0, z: z1, dx: 0, dz: -1, heading: Math.PI },
      ]
      const ends: [number, number, Axis][] = [
        [block.i + 1, block.j, 'ew'],
        [block.i + 1, block.j + 1, 'ns'],
        [block.i, block.j + 1, 'ew'],
        [block.i, block.j, 'ns'],
      ]
      const back = d + STOP_MARGIN + VEHICLE_SPEC[kind].halfLength
      const stops = segments.map((seg, k): StopLine => {
        const [i, j, axis] = ends[k]!
        return { s: seg.start + seg.length - back, intersection: findIntersection(city, i, j), axis }
      })
      routes.push({ id: `${block.id}-${kind}`, kind, length: 2 * (w + h), segments, stops })
    }
  }
  return routes
}

export function initTraffic(city: CityMap): TrafficState {
  const routes = buildRoutes(city)
  const vehicles: Vehicle[] = []
  routes.forEach((route, r) => {
    const rng = createRng(hashSeed(city.seed, 4, r))
    const count = rng.int(1, 3)
    const phase = rng.next() * route.length
    for (let k = 0; k < count; k++) {
      const s = (phase + (k * route.length) / count) % route.length
      vehicles.push({ id: `${route.id}-${k}`, kind: route.kind, route: r, s, speed: 0 })
    }
  })
  return { step: 0, t: 0, vehicles }
}

/** 由 a 往前走到 b 的距離（沿路線，0 ≤ 結果 < length） */
function ahead(a: number, b: number, length: number): number {
  const d = b - a
  return d >= 0 ? d : d + length
}

function nextStop(route: Route, s: number): StopLine {
  let best = route.stops[0]!
  let bestDist = Infinity
  for (const stop of route.stops) {
    const d = ahead(s, stop.s, route.length)
    if (d < bestDist) {
      best = stop
      bestDist = d
    }
  }
  return best
}

/** 推進一個固定步長；只用加減乘除，不用三角函數 */
export function stepTraffic(state: TrafficState, routes: Route[]): TrafficState {
  const byRoute = new Map<number, Vehicle[]>()
  for (const v of state.vehicles) byRoute.set(v.route, [...(byRoute.get(v.route) ?? []), v])

  const vehicles = state.vehicles.map((v): Vehicle => {
    const route = routes[v.route]!
    const spec = VEHICLE_SPEC[v.kind]
    const speed = Math.min(spec.speed, v.speed + ACCEL * STEP)
    let allowed = speed * STEP

    for (const other of byRoute.get(v.route) ?? []) {
      if (other === v) continue
      allowed = Math.min(allowed, ahead(v.s, other.s, route.length) - MIN_GAP)
    }

    const stop = nextStop(route, v.s)
    const toStop = ahead(v.s, stop.s, route.length)
    const mustStop = lightState(stop.intersection, stop.axis, state.t) !== 'green'
    if (mustStop && toStop <= allowed) {
      return { ...v, s: stop.s, speed: toStop / STEP }
    }

    const advance = Math.max(0, allowed)
    const next = v.s + advance
    return { ...v, s: next >= route.length ? next - route.length : next, speed: advance / STEP }
  })
  const step = state.step + 1
  return { step, t: step * STEP, vehicles }
}

export function advanceTraffic(state: TrafficState, routes: Route[], t: number): TrafficState {
  const target = Math.floor(t / STEP + 1e-9)
  let s = state
  while (s.step < target) s = stepTraffic(s, routes)
  return s
}

export function trafficAt(city: CityMap, t: number): TrafficState {
  return advanceTraffic(initTraffic(city), buildRoutes(city), t)
}

function segmentAt(routes: Route[], v: Vehicle) {
  const route = routes[v.route]!
  let seg = route.segments[0]!
  for (const candidate of route.segments) if (v.s >= candidate.start) seg = candidate
  return seg
}

export function vehiclePose(routes: Route[], v: Vehicle): Pose {
  const pose = { pos: { x: 0, z: 0 }, heading: 0 }
  writeVehiclePose(routes, v, pose)
  return pose
}

/** 把車輛位置與朝向寫進 out，供每幀渲染重用同一份物件 */
export function writeVehiclePose(routes: Route[], v: Vehicle, out: Pose): void {
  writeVehiclePos(routes, v, out.pos)
  out.heading = segmentAt(routes, v).heading
}

/** 把每台車的碰撞圓依序寫進 out（重用既有物件），回傳寫入數量 */
export function writeVehicleCircles(routes: Route[], vehicles: readonly Vehicle[], out: Circle[]): number {
  let n = 0
  for (const v of vehicles) {
    const seg = segmentAt(routes, v)
    const u = v.s - seg.start
    const spec = VEHICLE_SPEC[v.kind]
    for (const along of spec.circles) {
      const circle = (out[n] ??= { pos: { x: 0, z: 0 }, radius: 0 })
      circle.pos.x = seg.x + seg.dx * (u + along)
      circle.pos.z = seg.z + seg.dz * (u + along)
      circle.radius = spec.radius
      n++
    }
  }
  return n
}

/** 把車輛位置寫進 out，供每幀碰撞重用同一份物件 */
export function writeVehiclePos(routes: Route[], v: Vehicle, out: Vec2): void {
  const seg = segmentAt(routes, v)
  const u = v.s - seg.start
  out.x = seg.x + seg.dx * u
  out.z = seg.z + seg.dz * u
}
