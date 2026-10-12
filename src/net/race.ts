import { get, onValue, ref, serverTimestamp, set, update, type Database } from 'firebase/database'
import type { RaceChannel } from '../game/online'
import { EMPTY_RACE, type RaceSnapshot } from '../modes/race/link'
import type { AiNet, Progress, RaceMeta } from '../sim/race'

interface RaceNode {
  meta?: RaceMeta
  progress?: Record<string, Progress>
  ai?: Record<string, AiNet>
}

function readRace(node: RaceNode | null): RaceSnapshot {
  if (!node) return EMPTY_RACE
  return { meta: node.meta ?? null, progress: node.progress ?? {}, ai: node.ai ?? {} }
}

/** 房間的 race 節點；完成時間一律由伺服器蓋上 */
export function createRaceChannel(db: Database, roomPath: string, uid: string): RaceChannel {
  const raceRef = ref(db, `${roomPath}/race`)
  /** 最近一次收到的內容，用來判斷 AI 的完成時間是否已寫入 */
  let latest = EMPTY_RACE

  return {
    watch(onChange, onError) {
      return onValue(
        raceRef,
        (snap) => {
          latest = readRace(snap.val() as RaceNode | null)
          onChange(latest)
        },
        onError,
      )
    },

    async start(ai, cps, entrants) {
      const n = ((await get(ref(db, `${roomPath}/race/meta/n`))).val() as number | null) ?? 0
      await set(raceRef, { meta: { n: n + 1, ai, cps, at: serverTimestamp(), entrants } })
    },

    sendProgress({ n, cp, fin }) {
      return set(ref(db, `${roomPath}/race/progress/${uid}`), fin === undefined ? { n, cp } : { n, cp, fin: serverTimestamp() })
    },

    // 逐欄位更新，已寫入的完成時間不會被覆蓋；規則不允許改寫完成時間
    sendAi(ais) {
      const paths: Record<string, unknown> = {}
      for (const [k, { fin, ...pose }] of Object.entries(ais)) {
        for (const [field, value] of Object.entries(pose)) paths[`ai/${k}/${field}`] = value
        const stored = latest.ai[k]
        const finStored = stored?.n === pose.n && stored.fin !== undefined
        if (fin !== undefined && !finStored) paths[`ai/${k}/fin`] = serverTimestamp()
      }
      return update(raceRef, paths)
    },
  }
}
