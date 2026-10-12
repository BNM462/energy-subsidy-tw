// POST /api/internal/ai-extract — 爬蟲送來新補助的官方公告全文，由伺服器請 Gemini 整理卡片欄位（需 INGEST_TOKEN）。
// Gemini 金鑰只在伺服器端；每日次數上限保護免費額度，不影響訪客的智慧小幫手。
import { json, error, checkInternalAuth, readJsonBody } from '../../../server/http.js';
import { extractWithAI, MAX_SOURCE_CHARS } from '../../../server/ai-extract.js';
import { taipeiDate } from '../../../public/js/logic.js';

const DAILY_CAP = 30;

export async function onRequestPost({ request, env }) {
  if (!checkInternalAuth(request, env)) return error(401, 'unauthorized');
  let body;
  try {
    body = await readJsonBody(request, 512 * 1024);
  } catch (e) {
    return error(400, `invalid payload: ${e.message}`);
  }
  const text = typeof body?.text === 'string' ? body.text.slice(0, MAX_SOURCE_CHARS) : '';
  if (text.length < 50) return error(400, '公告全文過短');

  const counter = await env.DB.prepare(
    `INSERT INTO counters (key, value) VALUES (?1, 1)
     ON CONFLICT(key) DO UPDATE SET value = value + 1 WHERE value < ?2 RETURNING value`,
  )
    .bind(`ai_extract_${taipeiDate()}`, DAILY_CAP)
    .first();
  if (!counter) return json({ ok: false, reason: 'daily_cap' });

  const r = await extractWithAI(env, { title: String(body.title || '').slice(0, 300), agency: String(body.agency || '').slice(0, 100), text });
  return json(r);
}
