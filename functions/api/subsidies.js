// GET /api/subsidies — 今年（台灣時間）公告的補助清單
import { json, error } from '../../server/http.js';
import { listSubsidies, getMeta } from '../../server/data.js';
import { taipeiYear } from '../../public/js/logic.js';

export async function onRequestGet({ env, request }) {
  const url = new URL(request.url);
  const current = taipeiYear();
  let year = current;
  const y = url.searchParams.get('year');
  if (y != null) {
    if (!/^\d{4}$/.test(y) || +y < 2020 || +y > current) return error(400, '年度格式錯誤');
    year = +y;
  }
  const [subsidies, meta] = await Promise.all([
    listSubsidies(env.DB, { year }),
    getMeta(env.DB, ['last_data_change_at']),
  ]);
  return json(
    {
      year,
      server_time: Date.now(),
      last_data_change_at: meta.last_data_change_at || null,
      subsidies,
    },
    { headers: { 'cache-control': 'public, max-age=60' } },
  );
}
