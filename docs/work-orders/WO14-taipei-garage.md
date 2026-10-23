# WO14 · 台北東區路網、路名牌、自由騎車與商店

規則見 [00-rules.md](../spec/00-rules.md) §1-3、§1-4、§1-5、§1-9、§2-9、§2-10、§7，節點見 [01-flow.md](../spec/01-flow.md) 的 C1-7、C1-9、C1-10、D6、D7。

## 範圍

- `sim/city.ts`、`sim/types.ts`：路名照台北東區相對位置；道路分段路名（中山北路／中山南路）；台北101、大安森林公園、東區商店街、文湖線與車站固定位置；`roadNameAt`；`buildSigns` 產生路口路名牌與地標立牌。
- `render/city/Signs.tsx`（新）、`render/city/Mrt.tsx`、`render/materials.ts`：路名牌、地標立牌、捷運站名牌。
- `sim/player.ts`：`summonBike`、`stowBike`。玩家只有一個 `bike` 欄位，召喚取代、下車設成 `null`。
- `game/engine.ts`、`game/input.ts`：`summonBike` 動作（B）、騎車按 E 收車、`equip(build)`。
- `modes/race/controller.ts`：比賽中擋掉 `summonBike`。
- `ui/PartPicker.tsx`（新，從整備站抽出）、`modes/freeRoam/Shop.tsx`（新）、`modes/freeRoam/FreeRoamHud.tsx`：「進入商店」「召喚腳踏車」按鈕與商店畫面。
- 不改 `database.rules.json`：自由騎車沿用既有 `mode: 'bike'` 與 `bike` 欄位。

## 測試對照

| 編號 | 測試 |
|---|---|
| C1-7、C1-9、C1-10 | `sim/city.test.ts` |
| D6-1 ~ D6-5 | `game/engine.test.ts`、`modes/race/controller.test.ts`（比賽中召喚） |
| D6-6 | `tests/e2e/freeroam.spec.ts` |
| D7-2、D7-3 | `game/engine.test.ts` |
| D7-1、D7-4、D7-5 | `tests/e2e/freeroam.spec.ts` |

B2-6 改成檢查畫出來的傾角落在房主同一時段寫入的傾角範圍內（路網改變後 AI 會在不同位置轉彎，傾角是瞬間值）。
