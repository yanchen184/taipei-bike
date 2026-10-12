# 02 · 架構

## 技術棧

React 19 + TypeScript (strict) + Vite + Tailwind CSS v3。3D 用 three.js + @react-three/fiber + @react-three/drei。
連線用 Firebase（Auth 匿名登入、Realtime Database）。
測試：Vitest（`src/sim/`）、Vitest + Firebase Emulator（連線與安全規則）、Playwright（E2E，接 Emulator）。
部署：GitHub Actions → GitHub Pages。

不用物理引擎。開車與碰撞是自己寫的街機式運算（圓形對軸對齊矩形），放在 `src/sim/`，可以單元測試。

## 分層

```
src/
  sim/            純函式，不 import React / three / Firebase
    types.ts        Vec2、Rect、CityMap、PlayerState…
    rng.ts          seeded RNG（mulberry32）
    city.ts         generateCity(seed): CityMap（§1）
    lights.ts       lightState(intersection, t)（§1-6）
    clock.ts        遊戲時鐘、日夜（§1-7）
    traffic.ts      NPC 交通（§1-8）
    collide.ts      圓形對矩形的推出運算
    player.ts       步行、上下車、叫車、開車、扶正（§2）
    homes.ts        門口判定、室內格局、住戶（§3）
    save.ts         存檔序列化（§4）
    sync.ts         上傳節流、補間（§6）
  modes/          玩法模式（§5）
    types.ts        GameMode 介面
    manager.ts      切換模式、清除前一個模式
    freeRoam/
  net/            Firebase 初始化、room repository、presence
  render/         three 場景元件（城市、車、角色、室內、其他玩家）
  ui/             標題、HUD、選單、拜訪手冊、連線畫面
  game/           GameLoop：讀鍵盤 → 呼叫 sim → 更新 store
  App.tsx
```

規則只寫在 `sim/`。畫面元件只讀 state，不自己判斷規則。

## 座標

- x 向東、z 向南、y 向上，單位公尺。
- 朝向 `heading`（弧度）：前進方向 = `(sin h, cos h)`，與 three.js 的 `rotation.y` 一致。
- 地圖：4×4 個街廓，街廓 60 m，道路 16 m（人行道 2＋車道 5＋中線 2＋車道 5＋人行道 2），每軸 5 條道路。地圖邊長 5×16＋4×60 = 320 m，外圍是邊界牆。

## 城市資料

```ts
interface CityMap {
  seed: number
  size: number
  roads: Road[]                 // { id, axis: 'ew' | 'ns', index, center, name }
  intersections: Intersection[] // { id, x, z, i, j, offset }
  blocks: Block[]               // { id, i, j, rect, kind: 'apartment' | 'shops' | 'park' | 'landmark' }
  buildings: Building[]         // { id, rect, floors, kind, color, sign? }
  props: Prop[]                 // 樹、長椅、溜滑梯、路燈、停放機車
  homes: Home[]                 // { id, address, door: Vec2, facing, buildingId, seed, resident }
  mrt: { roadId, pillars: Rect[], stations: Rect[] }
  colliders: Rect[]             // 建築物、邊界牆、捷運柱、有體積的道具
}
```

- 公寓的碰撞矩形從街廓邊往內退 3 m，退出來的那條就是騎樓；上方樓層在畫面上蓋過騎樓，但不算碰撞。
- 大門位置在建築物正面外 1 m（在騎樓內）。
- 捷運沿一條南北向道路的中線架高，柱子立在 2 m 中線上。

## 紅綠燈與時鐘

- 所有時間相關的狀態都是「世界時間 t（秒）」的純函式。單人時 t 從開局起算；連線時 t = 伺服器時間 − 房間建立時間。
- 每個路口一個循環 20 秒：東西向 綠 0–8／黃 8–10／紅 10–20，南北向 紅 0–10／綠 10–18／黃 18–20，再加上依路口位置決定的固定偏移。
- 遊戲時刻 = 08:00 + t × 144（10 分鐘 = 24 小時）。

## NPC 交通

- 每條 NPC 路線是繞「單一街廓」順時針一圈，只右轉。汽車走內側車道，機車走靠人行道的機車道。這樣每段車道只屬於一條路線，路線之間不會交錯，前後車距只要在同一路線內檢查。
- 用固定步長 1/30 秒從 t = 0 推進到現在的 t。只做軸向移動與加減，不用三角函數，確保不同瀏覽器算出同一個結果。加入房間時先快轉到目前的 t。
- 接近路口時，若該方向是紅燈或黃燈、且還沒越過停止線，就停在停止線前。

## 玩家狀態

```ts
interface PlayerState {
  mode: 'walk' | 'drive'
  pos: Vec2; heading: number            // 步行時是人，開車時人跟著車
  car: { pos: Vec2; heading: number; speed: number }
  location: { kind: 'outdoor' } | { kind: 'home'; homeId: string }
  odometer: number                      // 累計開車里程（公尺）
}
```

`stepPlayer(state, input, dt, city)` 回傳新的 state，不改舊的。

## 模式

```ts
interface GameMode {
  id: string
  name: string
  Scene: React.FC            // 模式自己的 3D 物件
  Hud: React.FC              // 模式自己的 HUD
  onEnter?(ctx: ModeContext): void
  onExit?(ctx: ModeContext): void
}
```

`ModeManager` 一次只保留一個模式。切換時先呼叫舊模式的 `onExit`，再卸載它的 `Scene`／`Hud`，然後掛上新模式。Phase 2 的腳踏車競速在 `modes/race/` 新增，不改 `sim/city.ts`。

## Realtime Database 資料模型

路徑全部放在 `taipeiBike/` 底下，不跟同一個資料庫裡的其他遊戲衝突。

```
taipeiBike/rooms/{code}/
  meta:    { seed, creatorUid, createdAt }                 // createdAt 用 serverTimestamp
  slots:   { "0"…"5": uid }                              // 6 個位子，主動離開時移除
  players: { [uid]: { name, joinedAt } }                 // onDisconnect 移除
  states:  { [uid]: { x, z, h, mode, cx, cz, ch, loc, t } } // 每秒至多 10 次，onDisconnect 移除
```

- 建房：隨機 4 碼房號，用 transaction 寫 `meta`，房號已存在就重抽。加入失敗時刪除剛建立的 `meta`。
- 加入：先登記一筆 onDisconnect，斷線時移除 `players/{uid}` 與 `states/{uid}`；再用一筆多路徑 update 同時寫 `slots/{n}` 與 `players/{uid}`。規則要求 `players/{uid}` 存在時恰好有一個位子是自己，所以人數上限由伺服器把關；同時搶同一個位子時只有一人成功，其他人換下一個位子，沒有位子就回報「房間已滿」。Realtime Database 規則沒有計算子節點數量的方法，所以用固定位子而不是數 `players`。
- 可占的位子：空位，或主人已不在 `players` 的位子（斷線玩家留下的）。斷線時的寫入每個路徑各自用斷線前的資料檢查規則，位子無法跟玩家資料一起在斷線時移除，所以改由下一位加入的人接手。
- 離開：一筆多路徑 update 同時移除 `slots/{n}`、`players/{uid}`、`states/{uid}`，並取消 onDisconnect。
- 重新連線：自己不在 `players` 時重新加入；失敗時回報錯誤，重新加入成功後清除錯誤；間隔從 0.5 秒起加倍、最多 10 秒重試。停止監聽時中止進行中的重新加入：之後不再寫入位子與玩家資料，已寫入的會移除。
- 停止同步（遊戲畫面卸載）只停止監聽與上傳，不離開房間；玩家資料在連線中斷時由 onDisconnect 移除。Phase 1 離開房間的方式是關閉頁面。
- 上傳狀態：前一筆完成才送下一筆；寫入失敗時之後重送同一個狀態，成功後清除錯誤；重新加入後重送目前狀態。
- 房主 = `players` 中 `joinedAt` 最小的人，由客戶端算，不另外寫入。房主離開後自然換人。
- 世界時間用 `.info/serverTimeOffset` 校正。
- 補間：保留每位玩家最近兩筆狀態，畫面時間比最新的落後 100 ms，在兩筆之間線性內插位置、最短角度內插朝向。

### 安全規則

- 必須登入（匿名也算）。
- `meta`：只能在不存在時建立，之後不能改；房間沒有 `slots`、`players`、`states` 時建立者可以刪除。
- `slots/{n}`：n 只能是 0–5；值必須是自己的 uid，同一筆寫入必須讓自己在 `players` 內，且同一個 uid 只能占一個位子。空位、自己的位子、主人不在 `players` 的位子可以寫入；只有占的人能釋放，而且要同時移除自己的 `players`。
- `players/{uid}`：只有本人能寫；存在時必須恰好有一個位子是自己。
- `states/{uid}`：只有本人能寫；寫入時本人必須在 `players` 內。
- 暱稱：2–12 字（規則以 UTF-16 長度計），頭尾不能是空白或換行。
- 所有欄位檢查型別，不允許多餘欄位；`createdAt`、`joinedAt`、`t` 必須是伺服器時間。
- 讀：已登入者可讀房間（加入前需要讀 meta 判斷房間是否存在）。

### 已知限制

位置由客戶端自己回報，玩家可以用開發者工具假造位置。Phase 1 沒有勝負，不做伺服器端驗證；Phase 2 的處理見下方「已知限制（Phase 2）」。

## 測試掛鉤

開發環境，或網址帶 `?debug=1` 時，`window.__taipei` 提供：讀目前狀態、瞬移、設定世界時間、取得某戶大門位置。E2E 與線上驗收透過它定位與檢查狀態，不靠畫面像素判斷位置。

## Phase 2：腳踏車競速

規則見 [00-rules.md](00-rules.md) §8–§11，節點見 [01-flow.md](01-flow.md) 的 B／K／A／G／N。

### 新增與修改的模組

```
src/
  sim/
    vehicle.ts      VehicleState、VehicleSpec（CAR_SPEC、BIKE_SPEC）、moveVehicle：汽車與腳踏車共用的加減速、轉向、碰撞反彈
    player.ts       PlayerState 加上 mode 'bike' 與 bike；mountBike、dismountBike
    course.ts       generateCourse(city, n)、檢查點判定、重生位置（§9）
    ai.ts           AI 的輸入、推進、卡住處理（§10）
    race.ts         倒數、名次、比賽結束判定（§8、§11）
  modes/race/
    link.ts         RaceLink 介面＋單人用的本機實作
    controller.ts   RaceController：一局比賽的狀態、房主算 AI、切換模式
    index.tsx       createRaceMode(controller): GameMode；createRace 建立控制器並接上模式切換
    RaceScene.tsx   檢查點標示、AI 腳踏車
    RaceHud.tsx     倒數、檢查點 x / N、時間、名次、成績表、退出比賽
    RaceLobby.tsx   自由逛街時的開賽面板
  net/race.ts       RaceLink 的 Realtime Database 實作
  game/engine.ts    加上 EngineHooks 掛點
```

`sim/city.ts` 不改。

### 腳踏車

- `PlayerState.mode` 多一個 `'bike'`，`PlayerState.bike: VehicleState | null` 是比賽用的腳踏車，第一次開賽前為 `null`；騎車時 `pos`／`heading` 跟著腳踏車。
- 汽車與腳踏車共用 `moveVehicle`，差別只在 `VehicleSpec`（`CAR_SPEC`、`BIKE_SPEC`）：

| | 半徑 | 最高速 | 倒退最高 | 加速 | 煞車 | 滑行減速 | 轉向 |
|---|---|---|---|---|---|---|---|
| 汽車 | 1.6 m | 22 m/s | 6 m/s | 7 | 14 | 2.5 | 1.7 rad/s |
| 腳踏車 | 0.6 m | 12 m/s | 3 m/s | 4 | 10 | 1 | 2.2 rad/s |

- `mountBike(state, pose)`：放到起跑格或重生點、速度 0、地點設為戶外。`dismountBike(state, city)`：用下車的同一套找空位邏輯，車子不動。

### 賽道

```ts
interface Course {
  n: number              // 局數
  nodes: Vec2[]          // 依序經過的路口中心，nodes[0] 是起點
  checkpoints: number[]  // 檢查點是 nodes 的第 2、4、6…個，最後一個是終點
  grid: Pose[]           // 6 個起跑格
}
```

- 亂數 seed 是 `hashSeed(city.seed, 7, n)`（城市與房間共用同一個 seed）。先決定總段數 12–16（偶數），再從隨機路口出發，用回溯法走不重複的相鄰路口（5×5 路口格），鄰居順序由亂數決定。
- 起跑格在第一段路上、離起點路口 4–14 m，兩欄（路中線左右各 3 m）× 三排，朝向第二個路口。
- 檢查點判定只看「下一個」檢查點：距離 ≤ 8 m 就加一。
- 重生位置：最後通過的檢查點所在路口中心，朝向下一個路口；還沒通過檢查點時回自己的起跑格。

### AI

```ts
interface AiRider {
  bike: VehicleState
  wp: number     // 下一個要去的 nodes 索引
  cp: number     // 已通過的檢查點數
  anchor: Vec2   // 卡住判定的參考點
  still: number  // 離 anchor 不到 3 m 的累計秒數，滿 3 秒就重生
  fin: boolean
}
```

- 路線：與路段平行、離路中線一段距離的直線。依序試行進方向右側 7 m（路邊）、路中線 0 m，取前方 1–12 m 內沒被擋到的第一條；擋到的判定是線段離障礙物圓或建築物的距離小於腳踏車半徑 + 0.3 m。都被擋時走右側 7 m。
- 檢查點路口進入前 20 m 內、離開後 10 m 內固定走路中線，確保經過檢查點 8 m 內。
- 目標點：自己在路線上的位置再往前 6 m，不超過這一段與下一段路線的交點。
- 離交點不到 2 m 時換下一個路口。
- 轉向輸入 = −朝向誤差 × 2.5，限制在 ±1。距離交點 20 m 內且要轉彎時，目標速度降到 6 m/s。
- 碰撞圓用 `riderCircles` 產生：已完賽的選手不產生碰撞圓。
- 第 k 台（0 起算）最高速 `8.5 + 0.7k` m/s。
- 只用固定步長 1/30 秒推進；同樣的起點、賽道、障礙物得到同樣的結果。

### 比賽狀態

```ts
interface RaceMeta {
  n: number                         // 局數，每開一局加一
  ai: number                        // AI 台數
  cps: number                       // 檢查點數
  at: number                        // 開賽的伺服器時間；倒數結束 = at + 3000
  entrants: Record<string, number>  // 參賽玩家 uid → 起跑格
}
interface Progress { n: number; cp: number; fin?: number }   // fin = 完成的伺服器時間
interface AiNet { n: number; x: number; z: number; h: number; s: number; w: number; cp: number; fin?: number }
```

- 階段由伺服器時間推算：`now < at + 3000` 倒數；之後比賽中；`raceOver` 為真就結束（§11-3）；「第一位完成」用 `firstFinish` 從本局全部進度（含已離開房間的選手）算出。每台電腦各自用校正過的伺服器時間算，不另外寫入狀態。
- 起跑格：參賽玩家依 `joinedAt` 排 0、1、2…，AI 依序用剩下的格子。

### RaceLink 與 RaceController

```ts
interface RaceLink {
  readonly selfId: string
  serverNow(): number
  isHost(): boolean
  /** 參賽玩家（依加入先後）與名字；單人時只有自己 */
  roster(): readonly { id: string; name: string }[]
  watch(onChange: (snap: RaceSnapshot) => void): () => void
  start(ai: number, cps: number): Promise<void>     // 房主開新的一局
  sendProgress(p: Progress): Promise<void>
  sendAi(ai: Record<string, AiNet>): Promise<void>
}
```

- 單人用 `localRaceLink`：資料放記憶體，時間用 `Date.now()`，自己就是房主。
- 連線用 `net/race.ts`：讀寫 `race/` 節點，房主沿用 `hostOf`（`joinedAt` 最小）。
- `RaceController` 一個 session 一個：
  - 收到新的一局且自己在 `entrants` 裡 → 切到競速模式；按「回到城市」或「退出比賽」→ 切回自由逛街。
  - 每幀由引擎的 `afterStep` 呼叫：判定自己的檢查點並依序上傳進度；房主推進 AI，每秒至多 10 次上傳 `ai`。
  - 自己的腳踏車的碰撞圓 = 其他參賽玩家（補間後位置）＋ AI；AI 的碰撞圓 = 其他 AI ＋ 所有參賽玩家 ＋ NPC 車。已完賽的選手都不算在內。
  - 房主換人時，新房主用最後收到的 `ai` 資料建立 AI 繼續算，`anchor` 設為目前位置、`still` 設為 0。
  - 非房主畫 AI 時，跟其他玩家一樣保留最近兩筆、落後 100 ms 補間。

### 引擎掛點

```ts
interface EngineHooks {
  obstacles?(): readonly Circle[]      // 額外的碰撞圓
  controls?(): boolean                 // false 時本幀輸入歸零（倒數中、已完成）
  action?(action: Action): boolean     // 回傳 true 表示已處理，引擎不再處理
  afterStep?(state: GameState, dt: number): void
}
engine.setHooks(hooks | null)
engine.trafficObstacles(): readonly Circle[]  // 本幀 NPC 車的碰撞圓
```

競速模式的 `onEnter` 設定掛點並讓玩家騎上腳踏車，`onExit` 清掉掛點並下車。RaceController 持有 RaceLink，`ModeContext` 不變；其他玩家離下一檢查點的距離用選項 `positionOf(id)` 取得的位置計算，拿不到位置時視為無限遠。

### Realtime Database

```
taipeiBike/rooms/{code}/race/
  meta:     RaceMeta
  progress: { [uid]: Progress }
  ai:       { "0"…"4": AiNet }
```

`states/{uid}.mode` 多一個 `'bike'`；騎車時 `x, z, h` 是腳踏車的位置。

開新的一局：房主一筆寫入整個 `race`，只含新的 `meta`，同時清掉上一局的 `progress` 與 `ai`。

### 安全規則

「房主」在規則裡的寫法：自己在 `players` 內，而且 6 個位子中每個有玩家資料的主人，`joinedAt` 都不小於自己的。同一毫秒加入的兩人都算房主。

- `race`：只有房主能寫，而且寫入後 `progress` 與 `ai` 都不存在（只能開新的一局或刪除整個比賽）。
- `race/meta`：`n` 是上一局加一（沒有上一局時是 1）；`ai` 0–5；`cps` 6–8；`at` 必須是伺服器時間；`entrants` 的每個 uid 必須在 `players` 內、值 0–5。
- `race/ai/{k}`：只有房主能寫；k 必須小於 `meta.ai`；`n` 等於目前局數；`fin` 寫入時必須是伺服器時間，之後不能改。
- `race/progress/{uid}`：只有本人能寫，且本人在 `players` 與 `meta.entrants` 內；`now ≥ at + 3000`；`n` 等於目前局數；`cp` 是上一筆加一（沒有本局資料時是 1），不超過 `cps`；`fin` 只能在 `cp = cps` 時寫入且必須是伺服器時間。
- 規則不數 `entrants` 人數，玩家加 AI 不超過 6 台由客戶端保證。

### 已知限制（Phase 2）

位置與通過檢查點都由客戶端自己判定，規則只保證「依序、不早於開跑、完成時間是伺服器時間」。改過的客戶端仍可以瞬移通過檢查點；本遊戲是朋友間連線，不做伺服器端驗證。
