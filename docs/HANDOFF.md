# 交接：Phase 2 競速（2026-10-12）

分支 `feat/phase2-race`。main 仍是 Phase 1（線上 https://yanchen184.github.io/taipei-bike/ ，SHA 304936d）。
**push main 會觸發 GitHub Actions 部署**，WO8 之前不要合併 main。

## 尊上已拍板的規則

- 每局隨機路線；選手之間會互撞；房主自選 0–5 台 AI（人 + AI ≤ 6）；沒有道具。

## 工單進度

| 工單 | 狀態 |
|---|---|
| WO5 競速模擬 | 已 commit（adff03e） |
| WO6 單人＋AI 流程 | 已 commit（5f5649d） |
| WO7 競速連線 | 程式與測試完成、本機驗證過；**還沒跑完整 flow:status、還沒 Codex review** |
| WO8 上線驗收 | 未開始 |

### WO7 已驗證（2026-10-12，本機）

- `npx tsc -b --noEmit` 通過
- `npx vitest run`：21 檔 120 個測試全過
- emulator 單元測試（`tests/emu/`）：41/41
- `tests/e2e/race-online.spec.ts`：G1-2、N1-1、N1-2、N1-4 共 4/4 通過

WO7 最後修的三個連線計時問題（都有 `[N1-1]` 單元測試）：

- 自己的完成時間改用伺服器寫入的 `fin`（`controller.ts` 的 `myFin`）
- 同一局的 `meta.at` 被伺服器修正時更新 round（serverTimestamp 先給本機估計值）
- 房主畫面上 AI 的完成時間優先用伺服器寫入的值（`aiFinOf`）

## 接下來的步驟

1. 跑完整 `npm run flow:status`，確認 `docs/flow-status.md` WO7 相關節點全 ✅。這台機器上次跑到一半因記憶體不足被系統中止，全套要 10 分鐘以上。
2. Codex review 兩段（先查是否符合 `docs/work-orders/WO7-race-net.md` 與 spec，再查程式品質），每輪開新 session，直到 APPROVED；review 後再改的程式要重新 review。prompt 草稿見本檔最後一節。
3. 真瀏覽器兩個分頁實際連線跑一局（`npm run dev` 連 emulator）。
4. commit WO7。
5. WO8（見 `docs/work-orders/WO8-race-deploy.md`）：**部署資料庫規則到 `bikes-bbd76` 前先問尊上**；部署規則 → 合併／push main → 線上驗收 `LIVE_URL=https://yanchen184.github.io/taipei-bike/ EXPECTED_SHA=<main 的 SHA> npm run flow:status`。
6. 更新流程圖與手冊。

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

- 起跑格附近有 NPC 車排隊，開賽時會把騎士推開 0.6–0.8 m。

## WO7 Codex review prompt 草稿

```
你是 code reviewer（只讀，不要改任何檔案）。專案：taipei-bike，分支 feat/phase2-race。
審查範圍：WO7 的 commit（實作 docs/work-orders/WO7-race-net.md）。
規格來源：docs/work-orders/WO7-race-net.md、docs/spec/00-rules.md、docs/spec/01-flow.md（N1、N2、G1-2、B1-5、A1-5）、docs/spec/02-architecture.md。
第一段「符合工單與 spec」：每條驗收條件都有 [ID] 測試且真的驗到；資料模型、伺服器時間戳、只有房主寫 AI、開賽後加入不參賽；database.rules.json 正確且不過寬。
第二段「程式品質」：競態、serverTimestamp 先估計後修正的影響、listener 清理、錯誤處理、型別、風格一致、註解只寫事實、不過度設計。
每個問題標 CRITICAL/HIGH/MEDIUM/LOW 附檔案:行號；最後一行只寫 VERDICT: APPROVED 或 VERDICT: REVISE（有 CRITICAL/HIGH 必須 REVISE）。用繁體中文。
```
