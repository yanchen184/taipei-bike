# WO12 · 體力與配速

規則見 [00-rules.md](../spec/00-rules.md) §9-12、§10-5，節點見 [01-flow.md](../spec/01-flow.md) 的 B3、A3。

## 範圍

- `sim/stamina.ts`（新）：`Stamina`（體力、連續踩踏秒數、沒力了）與 `stepStamina`：消耗每連續踩 4 秒翻倍、恢復 4% + 目前體力的 25%、耗光後到 30% 才能再踩。
- `sim/bike.ts`：`BikeState` 帶體力；只有按住 W 往前踩才耗體力，沒力了時 W 不加速；倒地時恢復。
- `sim/ai.ts`：AI 用同一套體力規則；AI 1 一直按著踩，AI 2 到直線速度就放開，AI 3–5 體力低於底線時只做不會掉體力的踩踏，並在終點前衝刺；移回路口時保留體力。
- `game/engine.ts`、`ui/Hud.tsx`：HUD 體力條與「沒力了」。

## 測試對照

| 編號 | 測試 |
|---|---|
| B3-1 ~ B3-3 | `sim/stamina.test.ts` |
| B3-4 | `sim/bike.test.ts` |
| B3-5 | `tests/e2e/race.spec.ts` |
| A3 | `sim/ai.test.ts` |

既有節點必須維持通過（W2-2 改成每秒補滿體力，只測零件）。
