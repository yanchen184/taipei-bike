import { onValue, ref, runTransaction, serverTimestamp, set, update, type Database } from 'firebase/database'
import type { RaceChannel } from '../game/online'
import { EMPTY_RACE, type RaceSnapshot } from '../modes/race/link'
import type { AiNet, BuildNet, Progress, RaceMeta } from '../sim/race'

interface RaceNode {
  meta?: RaceMeta
  progress?: Record<string, Progress>
  ai?: Record<string, AiNet>
  build?: Record<string, BuildNet>
}

function readRace(node: RaceNode | null): RaceSnapshot {
  if (!node) return EMPTY_RACE
  return { meta: node.meta ?? null, progress: node.progress ?? {}, ai: node.ai ?? {}, build: node.build ?? {} }
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

    // 伺服器確認前不在本機套用，被規則拒絕時其他畫面與自己都不會出現這一局；
    // 重試時局數可能改變，檢查點數跟著這次讀到的局數算
    async start(ai, cpsOf, entrants) {
      await runTransaction(
        raceRef,
        (node: RaceNode | null) => {
          const n = (node?.meta?.n ?? 0) + 1
          return { meta: { n, ai, cps: cpsOf(n), at: serverTimestamp(), entrants } }
        },
        { applyLocally: false },
      )
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

    sendBuild(build) {
      return set(ref(db, `${roomPath}/race/build/${uid}`), build)
    },
  }
}
