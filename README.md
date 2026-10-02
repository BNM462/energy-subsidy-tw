# 節能補助情報網

自動彙整「行政院各部會及其所屬中央機關」當年度公告的節能、能源效率相關補助。

- 網站：https://energy-subsidy-tw.pages.dev
- 每 30 分鐘由 GitHub Actions 自動檢查官方網站，有新資料直接寫入資料庫，網站即時讀取（不需重新部署）。
- 全部使用免費方案：Cloudflare Pages + Pages Functions + D1、GitHub Actions、Google AI Studio（Gemini 免費額度）。

> 本網站自動彙整中央政府公開資訊，實際申請資格、期限及補助內容仍以各主管機關最新官方公告為準。

## 架構

```
GitHub Actions（每 30 分鐘）
  crawler/run.mjs ──讀取──> 各部會官方網站（公告列表、補助專區、附件 PDF/ODT）
        │
        └──(INGEST_TOKEN 驗證)──> Cloudflare Pages Functions /api/internal/ingest ──> D1 資料庫
                                                                                  │
訪客瀏覽器 ──> Cloudflare Pages（public/）──> /api/subsidies、/api/view、/api/ask ──┘
                                                         └──> Gemini API（金鑰只在伺服器端）
```

| 位置 | 內容 |
|---|---|
| `public/` | 網站前台（HTML/CSS/JS，`js/logic.js` 為狀態、排序、台灣時間邏輯） |
| `functions/api/` | API（讀取、瀏覽次數、智慧小幫手、爬蟲寫入） |
| `server/` | API 共用程式（資料、Gemini、驗證） |
| `crawler/` | 爬蟲；`config/sources.json` 來源清單 |
| `migrations/` | D1 資料表 |
| `test/` | 自動化測試（`npm test`） |

## 人工修正（不需要後台）

- `crawler/config/manual_overrides.json`：永久覆寫某筆補助的日期、金額、對象、標題、狀態、內容。`target` 填網站「詳細資訊」最下方的「資料編號」或官方網址。
- `crawler/config/exclusions.json`：永久排除被誤判的網址或資料編號。
- `crawler/config/sources.json`：新增或停用資料來源（`enabled: false`）。

修改後 commit 到 GitHub，下一次自動掃描（30 分鐘內）就會套用，爬蟲不會改回去。

## 判定規則重點

- 只收錄中央機關公告；判定看實際內容是否含節約能源／能源效率提升，純太陽光電、儲能、電動車、碳盤查等不收錄。
- 抓不到的欄位一律顯示「官方未明載」，不推測。
- 民國年自動轉西元；所有日期以 Asia/Taipei 計算；截止日沒寫時間視為當天 23:59:59。
- 官方網站暫時無法連線時不刪除資料，下次重試；官方網址連續失效 3 次才標示「官方連結已失效」，資料仍保留。
- 有來源連續約 3 小時讀取失敗時，自動在 GitHub 開問題單（會寄 Email 通知）。

## 無法自動讀取的來源（已知限制）

| 機關 | 原因 |
|---|---|
| 環境部（本部網站） | 網站阻擋所有自動化連線；節能相關補助改由「環境部氣候變遷署」來源涵蓋 |
| 國防部 | robots.txt 禁止爬蟲，依規範不抓取 |
| 內政部國土管理署、交通部公路局 | 網站啟用機器人防護（需瀏覽器驗證） |

## 開發

```bash
npm install
npm test                      # 自動化測試
npm run crawl:dry             # 只掃描、不寫入（結果在 crawler/out/）
npx wrangler pages dev public # 本機預覽（需先 npm run db:migrate:local）
```

本機密鑰放在 `.dev.vars`（已列入 .gitignore，不會上傳）。
