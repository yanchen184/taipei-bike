# 交接：Phase 2 競速（2026-10-12）

分支 `yanchen184/goatfish`。Phase 2 已上線（https://yanchen184.github.io/taipei-bike/ ，main SHA b914f67）。
**push main 會觸發 GitHub Actions 部署**。

## 尊上已拍板的規則

- 每局隨機路線；選手之間會互撞；房主自選 0–5 台 AI（人 + AI ≤ 6）；沒有道具。

## 工單進度

| 工單 | 狀態 |
|---|---|
| WO5 競速模擬 | 已 commit（adff03e） |
| WO6 單人＋AI 流程 | 已 commit（5f5649d） |
| WO7 競速連線 | 已 commit（2754108、review 修正 e93aa27）；完整 flow:status 本機節點全 ✅；Codex 第 1–7 輪的問題都已修，Codex 第 9 輪 VERDICT: APPROVED（2026-10-12） |
| WO8 上線驗收 | 完成（2026-10-13）：規則已部署到 bikes-bbd76；main = b914f67，GitHub Actions 部署成功；線上 `flow:status` 32 個節點全 ✅（含 S1、S2） |
| WO9 賽前整備站 | 規格已寫進 00-rules §12、01-flow W1–W5、A2、N3（2026-10-13，尊上審過草稿）；尚未實作 |

### WO7 已驗證（2026-10-12，本機，commit e93aa27）

- `npm run build` 通過；`npx tsc -b`、`npx tsc --noEmit -p tsconfig.e2e.json` 通過
- `npx vitest run`：131/131
- emulator 單元測試（`tests/emu/`）：46/46
- `npm run flow:status`：除 S1、S2（線上驗收）外全部 ✅
- 線上驗收測試 `tests/live/race.spec.ts`（S2-1、S2-2）已寫好，用本機 vite＋emulator 當 LIVE_URL 跑過：2 passed
- 真瀏覽器（有畫面）兩個 browser context 連 emulator 跑一局 2 台 AI：賽道相同、互相看得到、AI 位置兩邊一致、成績表一致（腳本在 session scratchpad 的 `two-tab.cjs`，沒有進 repo）

Review 修正重點（e93aa27）：

- 開新一局等待伺服器確認期間不寫入進度與 AI、不重入；檢查點數依 transaction 讀到的局數算
- 加入時已是房主的人從最後同步的位置接手 AI；停止監聽時拿掉背景掛點
- rules：`meta` 不能部分修改；新局必須換局數並重蓋伺服器時間；同一局不能清掉進度與 AI；玩家完成時間寫入後不能刪改
- 3D 畫面加 `isolate`，名牌不再蓋住成績表等介面
- 已知限制：rules 不驗證 `cps` 是否等於該局賽道的檢查點數（規則算不出賽道），房主寫錯只影響自己的房間

## 接下來的步驟

- 實作 WO9（docs/work-orders/WO9-workshop.md）。待處理的小問題見下方「觀察到、尚未處理」。

## 新電腦環境

- Node.js、JDK 21（firebase emulator 需要 Java 21 以上；PATH 上若有舊版 Java，先把 `JAVA_HOME` 指到 JDK 21 並放到 PATH 最前面）。
- 用 package-lock 安裝依賴，並安裝 Playwright 的 chromium。
- 開發與測試一律用 emulator 專案 `demo-taipei-bike`（auth 9199、database 9010），不需要 `.env.local`。
- `.env.local` 不 commit；部署用的值放在 GitHub secrets。

## 常用指令（本機實際跑過）

```
npx tsc -b --noEmit
npx vitest run
npx firebase emulators:exec --only auth,database --project demo-taipei-bike "npx vitest run --config vitest.emu.config.ts"
npx firebase emulators:exec --only auth,database --project demo-taipei-bike "npx playwright test tests/e2e/race-online.spec.ts --reporter=line"
npm run flow:status
```

用 `--reporter=line` 手動跑的結果不會進 `docs/flow-status.md`，要算進狀態表一律跑 `npm run flow:status`。

## 限制

- 線上 Firebase 專案 `bikes-bbd76` 與 board-game-bike 共用（對方只用 Firestore）；本遊戲只用 Realtime Database 的 `taipeiBike/` 路徑。
- 不要把資料庫規則部署到 `sea-salt-5fb51`。
- 資料庫規則部署是手動的：`firebase deploy --only database --project bikes-bbd76`，執行前先問尊上。
- 程式風格：無分號、單引號；不要跑 prettier。

## 觀察到、尚未處理

- 目前沒有。（倒數時 AI 擋相機已改為靠近相機的選手半透明，G2-5；favicon 已補）

## WO7 Codex review prompt 草稿

```
你是 code reviewer（只讀，不要改任何檔案）。專案：taipei-bike，分支 yanchen184/goatfish。
審查範圍：WO7 的 commit（實作 docs/work-orders/WO7-race-net.md）。
規格來源：docs/work-orders/WO7-race-net.md、docs/spec/00-rules.md、docs/spec/01-flow.md（N1、N2、G1-2、B1-5、A1-5）、docs/spec/02-architecture.md。
第一段「符合工單與 spec」：每條驗收條件都有 [ID] 測試且真的驗到；資料模型、伺服器時間戳、只有房主寫 AI、開賽後加入不參賽；database.rules.json 正確且不過寬。
第二段「程式品質」：競態、serverTimestamp 先估計後修正的影響、listener 清理、錯誤處理、型別、風格一致、註解只寫事實、不過度設計。
每個問題標 CRITICAL/HIGH/MEDIUM/LOW 附檔案:行號；最後一行只寫 VERDICT: APPROVED 或 VERDICT: REVISE（有 CRITICAL/HIGH 必須 REVISE）。用繁體中文。
```
