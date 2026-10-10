# WO3 · 連線

## 範圍

Firebase 匿名登入、Realtime Database 房間（建房、加入、滿房、離開）、位置同步、presence、安全規則、連線 UI。

## 測試對照

| 編號 | 測試 |
|---|---|
| M1-1~M1-5 | Emulator：`tests/emu/rooms.test.ts`；M1-5 單元測試 |
| M2-1 | E2E：兩個 browser context |
| M3-1, M3-2 | `sim/sync.test.ts` 可見性判定＋E2E |
| M4-1, M4-2 | Emulator：關閉連線後資料移除、房主計算 |
| M5-1~M5-3 | Emulator：`tests/emu/rules.test.ts` |

## 需要尊上的事

線上要用哪個 Firebase 專案（見 WO4）。開發與測試只用 Emulator，不碰線上資料。
