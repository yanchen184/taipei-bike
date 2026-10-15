import { CITY_SIZE } from '../../sim/city'
import { checkpointPos, type Course } from '../../sim/course'
import { straights } from '../../sim/balance'
import { CHECKPOINT_COLOR, FINISH_COLOR } from './palette'
import { Roads } from './RaceMinimap'

/** 路線、點、圈的大小（m，跟著地圖縮放） */
const ROUTE_WIDTH = 10
const MARK_RADIUS = 22
const LABEL_SIZE = 26
/** 地圖四周留白，城市邊緣的起點與檢查點圈才不會被切掉 */
const PAD = MARK_RADIUS + 4

/** 整備站左邊的本局賽道預覽：俯視城市地圖、路線、起點、檢查點、轉彎數、最長直線 */
export function CoursePreview({ course }: { course: Course }) {
  const legs = straights(course)
  const start = course.nodes[0]!
  const last = course.checkpoints.length - 1
  return (
    <div className="flex flex-col gap-2">
      <svg
        data-testid="workshop-map"
        viewBox={`${-PAD} ${-PAD} ${CITY_SIZE + PAD * 2} ${CITY_SIZE + PAD * 2}`}
        className="aspect-square w-full rounded-xl bg-stone-900"
        aria-label="本局賽道"
        role="img"
      >
        <Roads />
        <polyline
          data-testid="workshop-route"
          points={course.nodes.map((n) => `${n.x},${n.z}`).join(' ')}
          fill="none"
          stroke="#fbbf24"
          strokeWidth={ROUTE_WIDTH}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle data-testid="workshop-start" cx={start.x} cy={start.z} r={MARK_RADIUS} fill="white" stroke="black" strokeWidth={3} />
        <text x={start.x} y={start.z} fontSize={LABEL_SIZE} fontWeight="bold" textAnchor="middle" dominantBaseline="central" fill="black">
          起
        </text>
        {course.checkpoints.map((_, k) => {
          const p = checkpointPos(course, k)
          return (
            <g key={k} data-testid="workshop-checkpoint">
              <circle cx={p.x} cy={p.z} r={MARK_RADIUS} fill={k === last ? FINISH_COLOR : CHECKPOINT_COLOR} stroke="white" strokeWidth={3} />
              <text x={p.x} y={p.z} fontSize={LABEL_SIZE} fontWeight="bold" textAnchor="middle" dominantBaseline="central" fill="white">
                {k === last ? '終' : k + 1}
              </text>
            </g>
          )
        })}
      </svg>
      <div className="flex justify-around text-sm">
        <span>
          轉彎 <b data-testid="workshop-turns">{legs.length - 1}</b> 個
        </span>
        <span>
          最長直線 <b data-testid="workshop-longest">{Math.round(Math.max(...legs))}</b> m
        </span>
        <span>
          檢查點 <b>{course.checkpoints.length}</b> 個
        </span>
      </div>
    </div>
  )
}
