# WO11 · 摔車、更強的 AI、煞車與極速平衡

規則見 [00-rules.md](../spec/00-rules.md) §9-11、§10、§12，節點見 [01-flow.md](../spec/01-flow.md) 的 B2、A1、W2。

## 範圍

- `sim/bike.ts`（新）：`BikeState`（傾角、晃動、倒地秒數）與 `stepBike`／`moveBike`：撞擊超過 1 m/s 摔車、低速大轉向 0.8 秒倒地、倒地 2 秒後原地扶起、轉彎傾斜。
- `sim/vehicle.ts`：`advanceVehicle` 回報撞擊速度與轉向角速度；腳踏車基準煞車 10 → 5。
- `sim/parts.ts`、`sim/balance.ts`：極速零件拉開差距，極速組裝能超過 50 km/h；煞車零件有實際差別。
- `sim/ai.ts`：AI 用同一套摔車物理；避撞（換路線、預測停車距離煞停、跟車優先、轉彎前檢查轉出方向、腳踩地慢轉／倒退脫困）；等待時間只算 1/10 的卡住判定。
- `sim/player.ts`、`sim/traffic.ts`、`sim/collide.ts`：選手與 AI 改用 `BikeState`。
- `game/engine.ts`、`ui/Hud.tsx`：倒地時 HUD 顯示「摔車了！」。
- `render/PlayerView.tsx`、`modes/race/RaceScene.tsx`、`modes/race/controller.ts`：車身傾斜（AI 傾角只有房主算得出來，同步資料沒有時為 0）。

## 測試對照

| 編號 | 測試 |
|---|---|
| B2-1 ~ B2-4 | `sim/bike.test.ts` |
| B2-5 | `tests/e2e/race.spec.ts`：摔車 HUD、倒地不能騎、2 秒後扶起 |
| A1-3、A1-5 | `sim/ai.test.ts` |
| A1-9 | `sim/ai.test.ts`：整條路被擋時煞停、不摔車 |
| W2 | `sim/parts.test.ts`、`sim/balance.test.ts`：極速組裝超過 50 km/h、煞車零件縮短停車距離 |

既有節點必須維持通過。

## 追加：連線同步傾角（B2-6）

- `database.rules.json`：`states/$uid` 與 `race/ai/$k` 可帶選填的 `l`（-1.6–1.6 rad），舊版不送也通過。
- `sim/sync.ts`、`net/rooms.ts`：`NetState.l` 同步、補間；讀到舊資料時為 0。
- `modes/race/controller.ts`、`sim/race.ts`：AI 同步帶 `l`，非房主補間傾角。
- `render/RemotePlayers.tsx`：其他玩家的腳踏車照傾角畫。

| 編號 | 測試 |
|---|---|
| B2-6 | `sim/sync.test.ts`、`modes/race/controller.test.ts`、`tests/emu/rules.test.ts`、`tests/emu/race-rules.test.ts`、`tests/e2e/race-online.spec.ts` |
