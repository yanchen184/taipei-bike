# WO5 · 競速規則（sim）

## 範圍

`sim/vehicle.ts`（汽車與腳踏車共用的車輛運算，`player.ts` 改用它）、`sim/course.ts`、`sim/ai.ts`、`sim/race.ts`。全部是純函式，不碰畫面與連線。

## 測試對照

| 編號 | 測試 |
|---|---|
| B1-1~B1-5 | `sim/vehicle.test.ts`：腳踏車規格的加速、倒退、轉向、撞牆、撞碰撞圓 |
| K1-1~K1-4 | `sim/course.test.ts`：多個 seed 與局數 |
| A1-1~A1-6 | `sim/ai.test.ts`：A1-2 每台 AI 單獨、A1-6 五台 AI 同場互撞，都在真實城市＋NPC 交通中模擬整條賽道 |
| G3-2 | `sim/race.test.ts`：名次排序 |
| G4-1 | `sim/race.test.ts`：三種結束時機 |

Phase 1 的 D3、D4 測試必須維持通過（汽車改用共用運算後行為不變）。
