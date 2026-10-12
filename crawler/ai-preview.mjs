// AI 整理試跑：讀取指定官方公告全文，請網站伺服器（Gemini）整理卡片欄位並印出結果，不寫入資料庫。
// 用法（GitHub Actions「AI 整理試跑」）：輸入一個或多個官方公告網址（以空白或逗號分隔）
import { pageWithDocsText } from './lib/source-text.mjs';

const API_BASE = (process.env.API_BASE || '').replace(/\/$/, '');
const TOKEN = process.env.INGEST_TOKEN || '';
const urls = (process.env.AI_PREVIEW_URLS || process.argv.slice(2).join(' ')).split(/[\s,]+/).filter(Boolean);
if (!API_BASE || TOKEN.length < 32) throw new Error('缺少 API_BASE 或 INGEST_TOKEN');

for (const url of urls) {
  console.log(`\n==================== ${url}`);
  try {
    const text = await pageWithDocsText(url);
    const title = text.split('\n').find((l) => l.trim().length >= 8) || '';
    const res = await fetch(`${API_BASE}/api/internal/ai-extract`, {
      method: 'POST',
      headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({ title, agency: '', text }),
      signal: AbortSignal.timeout(240000),
    });
    const r = await res.json();
    if (!r.ok) {
      console.log(`失敗：${r.reason || r.error || res.status}`);
      continue;
    }
    console.log(`全文 ${text.length} 字；模型 ${r.model}`);
    console.log(`補助重點：${r.fields.summary}`);
    console.log(`最高補助：${r.fields.amount_text}`);
    for (const d of r.fields.amount_details) console.log(`  金額明細：${d}`);
    for (const t of r.fields.target_points) console.log(`  補助對象：${t}`);
    for (const d of r.dropped) console.log(`  ✂ 已捨棄（數字對不上原文）：${d}`);
  } catch (e) {
    console.log(`失敗：${e.message}`);
  }
}
