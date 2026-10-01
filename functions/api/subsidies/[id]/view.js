// POST /api/subsidies/:id/view — 使用者點開「詳細資訊」時，該補助瀏覽次數 +1
import { json, error } from '../../../../server/http.js';

export async function onRequestPost({ env, params }) {
  const id = String(params.id || '');
  if (!/^[a-f0-9]{8,32}$/.test(id)) return error(400, '編號格式錯誤');
  const row = await env.DB.prepare('UPDATE subsidies SET views = views + 1 WHERE id = ? AND hidden = 0 RETURNING views')
    .bind(id)
    .first();
  if (!row) return error(404, '找不到這筆補助');
  return json({ id, views: row.views });
}
