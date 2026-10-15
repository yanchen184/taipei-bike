# WO9 · 賽前整備站

規則見 [00-rules.md](../spec/00-rules.md) §12（另有 §4、§8–§11 的修改），節點見 [01-flow.md](../spec/01-flow.md) 的 W1–W5、A2、N3。

## 範圍

- `sim/parts.ts`（新）：零件表、預算、組裝驗證、組裝 → 四項性能。純函式。
- `sim/vehicle.ts`：腳踏車規格改由組裝產生；加「過彎」：速度高於過彎值時轉向率乘上「過彎 ÷ 速度」。汽車不受影響。
- `sim/ai.ts`：拿掉固定的 `aiMaxSpeed`；AI 配車（seed＋局數決定）與騎法參數（直線踩踏比例、彎前減速）依 AI 1–5 分級；彎前目標速度依自己的組裝算。
- `sim/save.ts`：存檔版本 2，加上次的組裝；版本 1 升級。
- `modes/race/`：開賽後先進整備站（賽道預覽、四個部位、性能條、剩餘預算、整備倒數或「出發」），整備結束才倒數；成績表加組裝欄。
- `net/race.ts`、`database.rules.json`：`race/build/$uid`，進度的最早寫入時間改成開賽＋20 秒整備＋3 秒倒數（單人不經伺服器，不受影響）。
- 平衡模擬（W5、A2-2）放在 `sim/` 的測試裡，用同一套騎法在多個 seed 上跑所有合法組裝。

## 測試對照

| 編號 | 測試 |
|---|---|
| W1-1, W1-3 | `tests/e2e/race.spec.ts`（單人）＋`tests/e2e/race-online.spec.ts`（兩個 browser context，整備 20 秒後同時倒數） |
| W1-2 | `sim/parts.test.ts`＋E2E 選零件、超過預算的選項不能選 |
| W1-4 | `sim/save.test.ts`＋E2E 第二局帶入上一局的組裝 |
| W2-1~W2-3 | `sim/parts.test.ts`、`sim/vehicle.test.ts` |
| W3-1 | `tests/e2e/race-online.spec.ts`：兩邊成績表的組裝欄一致 |
| W5-1, W5-2 | `sim/balance.test.ts`：多個 seed、所有合法組裝 |
| A2-1~A2-4 | `sim/balance.test.ts`（與 W5 共用所有合法組裝的模擬） |
| N3-1, N3-2 | Emulator：`tests/emu/race-rules.test.ts` |
| B1-1、G1-1、N2-1、N2-3、P1-1、P1-2 | 既有測試依新條文更新 |

既有節點（含 Phase 1 的 D3、D4 汽車行為）必須維持通過。

## 需要尊上的事

- 零件數值是初版。W5 平衡測試不過時由 Claude 調數值，調完把新表寫回 §12-5 並回報。
- 上線前要把新的 `database.rules.json` 部署到 `bikes-bbd76`，部署前先問尊上。
