// GET /api/subsidies/:id — 單筆補助完整內容（不計瀏覽次數）
import { json, error } from '../../../server/http.js';
import { getSubsidy } from '../../../server/data.js';

export async function onRequestGet({ env, params }) {
  const id = String(params.id || '');
  if (!/^[a-f0-9]{8,32}$/.test(id)) return error(400, '編號格式錯誤');
  const sub = await getSubsidy(env.DB, id);
  if (!sub) return error(404, '找不到這筆補助');
  return json(sub, { headers: { 'cache-control': 'public, max-age=60' } });
}
