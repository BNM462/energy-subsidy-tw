// GET /api/internal/state — 爬蟲取得目前狀態（需 INGEST_TOKEN）
// 回傳完整欄位：爬蟲更新既有補助時是整筆寫回，缺欄位會造成資料被清空。
import { json, error, checkInternalAuth } from '../../../server/http.js';
import { taipeiYear } from '../../../public/js/logic.js';

const JSON_COLS = ['target_types', 'amount_details', 'source_urls', 'attachments', 'signals'];

function parse(row) {
  const out = { ...row, until_quota: !!row.until_quota };
  delete out.views; // 瀏覽次數由網站自行累計，爬蟲不碰
  for (const c of JSON_COLS) {
    try {
      out[c] = JSON.parse(row[c] || '[]');
    } catch {
      out[c] = [];
    }
  }
  return out;
}

export async function onRequestGet({ request, env }) {
  if (!checkInternalAuth(request, env)) return error(401, 'unauthorized');
  const db = env.DB;
  const [subs, urls, sources, meta] = await db.batch([
    db.prepare('SELECT * FROM subsidies WHERE year >= ? OR year IS NULL').bind(taipeiYear() - 1),
    db.prepare('SELECT url, source_id, verdict, subsidy_id, content_hash, first_seen_at, last_checked_at, fail_count FROM crawl_urls'),
    db.prepare('SELECT * FROM sources_status'),
    db.prepare('SELECT key, value FROM meta'),
  ]);
  return json({
    subsidies: subs.results.map(parse),
    crawl_urls: urls.results,
    sources: sources.results.map((s) => ({ ...s, discovered_lists: JSON.parse(s.discovered_lists || '[]') })),
    meta: Object.fromEntries(meta.results.map((r) => [r.key, r.value])),
  });
}
