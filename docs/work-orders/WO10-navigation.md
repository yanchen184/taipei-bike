# WO10 · 比賽導航：路口提示與小地圖

規則見 [00-rules.md](../spec/00-rules.md) §9-9、§9-10，節點見 [01-flow.md](../spec/01-flow.md) 的 G5。

## 範圍

- `sim/course.ts`：`nextTurn(course, cp, pos)` 純函式，回傳下一個路口的編號、轉向（左／右／直行／終點）與距離；完成後回傳 null。
- `modes/race/controller.ts`：`RaceView` 加上路口提示（轉向與以 10 m 為單位的距離）；公開其他參賽玩家的位置給小地圖。
- `modes/race/RaceHud.tsx`：上方那一列下面顯示路口提示。
- `modes/race/RaceMinimap.tsx`（新）：SVG 小地圖，車頭朝上；每幀用 ref 更新位置，不重新 render React。
- `ui/Hud.tsx`：騎車時速度表移到小地圖左邊。

## 測試對照

| 編號 | 測試 |
|---|---|
| G5-1 | `sim/course.test.ts`：多個 seed 的賽道上走一遍，轉向與叉積一致、過路口才換、檢查點附近與完成後的行為 |
| G5-2 | `tests/e2e/race.spec.ts`：瞬移到轉彎路口前，HUD 顯示該轉向與距離；瞬移過路口後換成下一個路口 |
| G5-3 | `tests/e2e/race.spec.ts`：小地圖與 AI 點數、速度表不與小地圖重疊、遠離檢查點時出現邊緣箭頭 |
| G5-4 | `tests/e2e/race.spec.ts`：退出比賽後小地圖與路口提示不在畫面上 |

既有節點必須維持通過。不動資料庫規則。
