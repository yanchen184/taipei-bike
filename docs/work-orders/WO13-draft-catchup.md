# WO13 · 破風、後追與隨機起跑格

規則見 [00-rules.md](../spec/00-rules.md) §8-3、§9-13、§9-14、§10-6，節點見 [01-flow.md](../spec/01-flow.md) 的 B4、A4、G1-5。

## 範圍

- `sim/aid.ts`（新）：破風強度、後追強度、`Aid`（極速倍率、消耗倍率）與沿路線的進度。
- `sim/ai.ts`：AI 3–5 刻意跟車（§10-6），衝刺前不超車。
- `sim/stamina.ts`、`sim/bike.ts`、`sim/player.ts`、`sim/ai.ts`：騎車時帶入 `Aid`，放大極速、縮小踩踏消耗；沒有加成時行為不變。
- `game/engine.ts`：新 hook `aid()`，騎車時取得自己的加成。
- `modes/race/controller.ts`：依其他選手位置與領先者進度算玩家與每台 AI 的加成；`RaceView` 帶 `draft`、`catchup`。
- `modes/race/RaceHud.tsx`：「破風 x%」「後追 x%」標籤。
- `sim/race.ts`、`modes/race/link.ts`：`drawGrid` 隨機分配起跑格，單人與連線都用。

## 測試對照

| 編號 | 測試 |
|---|---|
| B4-1 ~ B4-4 | `sim/aid.test.ts` |
| B4-5 | `tests/e2e/race.spec.ts` |
| A4-1、A4-2 | `sim/ai.test.ts` |
| G1-5 | `sim/race.test.ts` |
| G1-1、G2-5 | `tests/e2e/race.spec.ts`（玩家的起跑格不固定） |

既有節點必須維持通過；controller 測試用固定亂數讓玩家排在第一格。
