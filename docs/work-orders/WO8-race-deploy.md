# WO8 · 競速上線驗收

## 範圍

部署資料庫規則與網站，跑線上驗收。

## 測試對照

| 編號 | 測試 |
|---|---|
| S2-1 | live：單人開一局含 AI，倒數後騎出起跑格並通過第一個檢查點 |
| S2-2 | live：兩個 context 同一局，互見並看到同一組 AI，成績表一致 |

## 部署步驟

1. `firebase deploy --only database --project bikes-bbd76`（這個資料庫只有本遊戲在用，另一個 repo 只用 Firestore）。
2. push main，等 GitHub Actions 部署完成。
3. `LIVE_URL=https://yanchen184.github.io/taipei-bike/ EXPECTED_SHA=<main 的 SHA> npm run flow:status`。
