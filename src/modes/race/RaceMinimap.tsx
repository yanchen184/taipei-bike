import { useEffect, useRef } from 'react'
import { useEngine } from '../../game/EngineContext'
import { MAX_RACERS } from '../../sim/race'
import { CITY_SIZE, ROAD_WIDTH } from '../../sim/city'
import { checkpointPos, type Course } from '../../sim/course'
import type { Vec2 } from '../../sim/types'
import type { RaceController } from './controller'
import { CHECKPOINT_COLOR, FINISH_COLOR, aiColor } from './palette'
import { useRaceView } from './useRaceView'

/** 小地圖邊長（px） */
export const MINIMAP_SIZE = 176
/** 中心到邊緣代表的距離（m） */
const RANGE = 120
const SCALE = MINIMAP_SIZE / 2 / RANGE
const HALF = MINIMAP_SIZE / 2
/** 邊緣箭頭離邊緣的距離（px） */
const ARROW_INSET = 12
/** 路線、點、圈的大小（m，跟著地圖縮放） */
const ROUTE_WIDTH = 5
const DOT_RADIUS = 6
const MARK_RADIUS = 11

function points(nodes: readonly Vec2[]): string {
  return nodes.map((n) => `${n.x},${n.z}`).join(' ')
}

/** 世界座標 → 以自己為中心、車頭朝上的地圖座標（m）的旋轉矩陣 [a, b, c, d] */
function headingUp(heading: number): [number, number, number, number] {
  const fx = Math.sin(heading)
  const fz = Math.cos(heading)
  return [-fz, -fx, fx, -fz]
}

function setCircle(el: SVGCircleElement | null | undefined, pos: Vec2 | undefined): void {
  if (!el) return
  el.style.visibility = pos ? 'visible' : 'hidden'
  if (!pos) return
  el.setAttribute('cx', String(pos.x))
  el.setAttribute('cy', String(pos.z))
}

export function Roads() {
  const roads = useEngine().city.roads
  return (
    <g fill="rgba(255,255,255,0.18)">
      {roads.map((r) =>
        r.axis === 'ew' ? (
          <rect key={r.id} x={0} y={r.center - ROAD_WIDTH / 2} width={CITY_SIZE} height={ROAD_WIDTH} />
        ) : (
          <rect key={r.id} x={r.center - ROAD_WIDTH / 2} y={0} width={ROAD_WIDTH} height={CITY_SIZE} />
        ),
      )}
    </g>
  )
}

/** 路線（騎過的變淡）、終點與下一個檢查點 */
function Route({ course, cp }: { course: Course; cp: number }) {
  const passed = cp === 0 ? 0 : course.checkpoints[cp - 1]!
  const last = course.checkpoints.length - 1
  const finish = checkpointPos(course, last)
  const next = cp <= last ? checkpointPos(course, cp) : null
  return (
    <g fill="none" strokeLinecap="round" strokeLinejoin="round" strokeWidth={ROUTE_WIDTH}>
      <polyline points={points(course.nodes.slice(0, passed + 1))} stroke="rgba(251,191,36,0.3)" />
      <polyline data-testid="minimap-route" points={points(course.nodes.slice(passed))} stroke="#fbbf24" />
      {cp < last && <circle cx={finish.x} cy={finish.z} r={MARK_RADIUS} fill={FINISH_COLOR} stroke="white" strokeWidth={1.5} />}
      {next && (
        <circle
          data-testid="minimap-next"
          cx={next.x}
          cy={next.z}
          r={MARK_RADIUS}
          fill={cp === last ? FINISH_COLOR : CHECKPOINT_COLOR}
          stroke="white"
          strokeWidth={1.5}
        />
      )}
    </g>
  )
}

/** 比賽中右下角的小地圖：車頭朝上、自己在中央；位置每幀用 ref 更新，不重新 render */
export function RaceMinimap({ controller }: { controller: RaceController }) {
  const engine = useEngine()
  const view = useRaceView(controller)
  const course = controller.course()
  const world = useRef<SVGGElement>(null)
  const arrow = useRef<SVGPolygonElement>(null)
  const ais = useRef<(SVGCircleElement | null)[]>([])
  const rivals = useRef<(SVGCircleElement | null)[]>([])

  useEffect(() => {
    let frame = 0
    const draw = () => {
      frame = requestAnimationFrame(draw)
      const { pos, heading } = engine.state.player
      const [a, b, c, d] = headingUp(heading)
      world.current?.setAttribute('transform', `matrix(${a} ${b} ${c} ${d} ${-(a * pos.x + c * pos.z)} ${-(b * pos.x + d * pos.z)})`)
      const riders = controller.aiRiders()
      ais.current.forEach((el, k) => setCircle(el, riders[k]?.pos))
      const others = controller.rivals()
      rivals.current.forEach((el, k) => setCircle(el, others[k]))

      const round = controller.course()
      const cp = controller.view().cp
      const el = arrow.current
      if (!el) return
      const target = round && cp < round.checkpoints.length ? checkpointPos(round, cp) : null
      const dx = target ? target.x - pos.x : 0
      const dz = target ? target.z - pos.z : 0
      const sx = a * dx + c * dz
      const sy = b * dx + d * dz
      const far = Math.max(Math.abs(sx), Math.abs(sy))
      el.style.visibility = target && far > RANGE ? 'visible' : 'hidden'
      if (!target || far <= RANGE) return
      const t = (HALF - ARROW_INSET) / (far * SCALE)
      const deg = (Math.atan2(sx, -sy) * 180) / Math.PI
      el.setAttribute('transform', `translate(${sx * SCALE * t} ${sy * SCALE * t}) rotate(${deg})`)
    }
    draw()
    return () => cancelAnimationFrame(frame)
  }, [engine, controller])

  if (!course) return null
  const nextColor = view.cp === view.cps - 1 ? FINISH_COLOR : CHECKPOINT_COLOR
  return (
    <svg
      data-testid="race-minimap"
      width={MINIMAP_SIZE}
      height={MINIMAP_SIZE}
      viewBox={`${-HALF} ${-HALF} ${MINIMAP_SIZE} ${MINIMAP_SIZE}`}
      className="pointer-events-none absolute bottom-6 right-6 rounded-2xl bg-black/55 shadow-lg"
      aria-label="小地圖"
      role="img"
    >
      <defs>
        <clipPath id="minimap-clip">
          <rect x={-HALF} y={-HALF} width={MINIMAP_SIZE} height={MINIMAP_SIZE} rx={16} />
        </clipPath>
      </defs>
      <g clipPath="url(#minimap-clip)">
        <g transform={`scale(${SCALE})`}>
          <g ref={world}>
            <Roads />
            <Route course={course} cp={view.cp} />
            {Array.from({ length: MAX_RACERS - 1 }, (_, k) => (
              <circle
                key={`rival-${k}`}
                ref={(el) => {
                  rivals.current[k] = el
                }}
                data-testid="minimap-rival"
                r={DOT_RADIUS}
                fill="white"
                visibility="hidden"
              />
            ))}
            {Array.from({ length: view.ais }, (_, k) => (
              <circle
                key={`ai-${view.n}-${k}`}
                ref={(el) => {
                  ais.current[k] = el
                }}
                data-testid="minimap-ai"
                r={DOT_RADIUS}
                fill={aiColor(k)}
                stroke="white"
                strokeWidth={1}
              />
            ))}
          </g>
        </g>
        <polygon data-testid="minimap-self" points="0,-9 7,7 0,3 -7,7" fill="white" stroke="black" strokeWidth={1} />
        <polygon ref={arrow} data-testid="minimap-arrow" points="0,-8 7,6 -7,6" fill={nextColor} stroke="white" strokeWidth={1.5} visibility="hidden" />
      </g>
    </svg>
  )
}
