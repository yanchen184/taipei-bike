# WO7 · 競速連線

## 範圍

`net/race.ts`（RaceLink 的 Realtime Database 實作）、`database.rules.json` 的 `race/` 規則與 `states.mode = 'bike'`、房主算 AI 與換手、開賽面板的房主判斷、其他玩家 `mode = 'bike'` 時在 `x/z/h` 畫腳踏車與騎士（`RemotePlayers`）。

## 測試對照

| 編號 | 測試 |
|---|---|
| G1-2 | E2E：兩個 browser context，只有房主有開始按鈕、AI 上限 |
| N1-1 | E2E：兩個 browser context 同一局完賽，成績表一致 |
| N1-2, N1-3 | controller 單元測試（兩個 controller 共用假的 link）＋E2E 看 AI 位置 |
| N1-4 | E2E：開賽後加入 |
| N2-1~N2-4 | Emulator：`tests/emu/race-rules.test.ts` |

## 需要尊上的事

上線前要把新的 `database.rules.json` 部署到 `bikes-bbd76`（見 WO8）。
