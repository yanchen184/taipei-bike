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

位置由客戶端自己回報，玩家可以用開發者工具假造位置。Phase 1 沒有勝負，不做伺服器端驗證；Phase 2 比賽計時如果需要防作弊，要另外設計。

## 測試掛鉤

開發環境，或網址帶 `?debug=1` 時，`window.__taipei` 提供：讀目前狀態、瞬移、設定世界時間、取得某戶大門位置。E2E 與線上驗收透過它定位與檢查狀態，不靠畫面像素判斷位置。
