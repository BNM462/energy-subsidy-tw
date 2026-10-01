// POST /api/view — 首頁成功載入時，全站累積瀏覽次數 +1
import { json } from '../../server/http.js';

export async function onRequestPost({ env }) {
  const row = await env.DB.prepare(
    `INSERT INTO counters (key, value) VALUES ('site_views', 1)
     ON CONFLICT(key) DO UPDATE SET value = value + 1 RETURNING value`,
  ).first();
  return json({ site_views: row.value });
}
