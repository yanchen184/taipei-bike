# WO4 · 部署與線上驗收

## 範圍

GitHub repo、GitHub Actions → Pages、Firebase Realtime Database 規則部署、線上驗收 suite。

## 測試對照

| 編號 | 測試 |
|---|---|
| S1-1 | live：commit meta = main SHA |
| S1-2 | live：單人開車、下車、進門、出門 |
| S1-3 | live：兩個 context 同房互見移動 |

## 需要尊上同意的事

- 建立 GitHub repo `yanchen184/taipei-bike`（public，Pages 需要）並 push。
- Firebase：線上用哪個專案。部署 Realtime Database 規則會覆蓋該資料庫的整份規則，所以不能直接部署到其他遊戲正在用的資料庫。
- 把 Firebase 設定放進 GitHub secrets。

## 線上環境

- Firebase 專案 `bikes-bbd76`：與 `yanchen184/board-game-bike` 共用，那個 repo 只用 Firestore。本遊戲用 Realtime Database（`bikes-bbd76-default-rtdb`，資料在 `taipeiBike/`）與匿名登入。
- 資料庫規則不在 GitHub Actions 部署，改 `database.rules.json` 後手動執行：`firebase deploy --only database --project bikes-bbd76`。
- GitHub secrets：`VITE_FIREBASE_API_KEY`、`VITE_FIREBASE_AUTH_DOMAIN`、`VITE_FIREBASE_PROJECT_ID`、`VITE_FIREBASE_APP_ID`、`VITE_FIREBASE_DATABASE_URL`。
- 線上驗收：`LIVE_URL=https://yanchen184.github.io/taipei-bike/ EXPECTED_SHA=<main 的 SHA> npm run flow:status`。
