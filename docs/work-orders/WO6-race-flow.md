# WO6 · 競速流程（單人＋AI）

## 範圍

引擎掛點（`EngineHooks`）、`PlayerState` 的 `bike` 模式、`modes/race/`（RaceController、單人用 `localRaceLink`、場景、HUD、開賽面板、成績表）、測試掛鉤 `window.__taipei.race()`。

## 測試對照

| 編號 | 測試 |
|---|---|
| G1-1 | E2E：單人選 AI 數量開賽 |
| G1-3, G1-4 | `modes/race/controller.test.ts` |
| G2-1~G2-4 | controller 單元測試＋E2E（倒數、HUD、檢查點標示、R） |
| G3-1, G3-3 | controller 單元測試 |
| G4-2~G4-5 | E2E：瞬移依序通過檢查點完賽、成績表、回到城市、退出比賽；G4-5 用 `modes/manager` 測試 |

## 需要尊上的事

無。
