// GET  /api/ask — 查詢今日剩餘次數
// POST /api/ask — 智慧小幫手提問（伺服器端每人每日限制）
import { json, error, readJsonBody } from '../../server/http.js';
import { listSubsidies } from '../../server/data.js';
import {
  askGemini, buildContext, sanitizeAnswer, cleanQuestion, dailyClientId, NO_ANSWER, UNAVAILABLE, MAX_QUESTION,
} from '../../server/gemini.js';
import { taipeiDate } from '../../public/js/logic.js';

function limits(env) {
  return {
    perUser: Math.max(1, parseInt(env.ASK_DAILY_LIMIT || '5', 10)),
    global: Math.max(0, parseInt(env.ASK_GLOBAL_DAILY_LIMIT || '0', 10)), // 0 = 不另設全站上限
  };
}

async function clientId(request, env, day) {
  const ip = request.headers.get('cf-connecting-ip') || request.headers.get('x-real-ip') || 'unknown';
  const secret = env.ASK_HASH_SECRET || env.INGEST_TOKEN || 'local-dev-only';
  return dailyClientId(secret, day, ip);
}

async function usedToday(db, day, client) {
  const row = await db.prepare('SELECT count FROM ask_usage WHERE day = ? AND client = ?').bind(day, client).first();
  return row ? row.count : 0;
}

export async function onRequestGet({ request, env }) {
  const day = taipeiDate();
  const { perUser } = limits(env);
  const used = await usedToday(env.DB, day, await clientId(request, env, day));
  return json({ limit: perUser, remaining: Math.max(0, perUser - used), available: !!env.GEMINI_API_KEY });
}

export async function onRequestPost({ request, env }) {
  const day = taipeiDate();
  const { perUser, global } = limits(env);
  let body;
  try {
    body = await readJsonBody(request, 4096);
  } catch {
    return error(400, '請求格式錯誤');
  }
  const question = cleanQuestion(body?.question);
  if (!question) return error(400, '請輸入問題');
  if (question.length > MAX_QUESTION) return error(400, `問題請在 ${MAX_QUESTION} 字以內`);

  const db = env.DB;
  const client = await clientId(request, env, day);

  if (!env.GEMINI_API_KEY) {
    const used = await usedToday(db, day, client);
    return json({ ok: false, reason: 'not_configured', message: UNAVAILABLE, remaining: Math.max(0, perUser - used), limit: perUser });
  }

  // 原子操作：未達上限才 +1
  const row = await db
    .prepare(
      `INSERT INTO ask_usage (day, client, count) VALUES (?1, ?2, 1)
       ON CONFLICT(day, client) DO UPDATE SET count = count + 1 WHERE count < ?3
       RETURNING count`,
    )
    .bind(day, client, perUser)
    .first();
  if (!row) {
    return json({
      ok: false,
      quota_exceeded: true,
      message: `您今日的 ${perUser} 次智慧小幫手使用額度已用完，明日即可再次使用。`,
      remaining: 0,
      limit: perUser,
    });
  }

  const refund = () =>
    db.prepare('UPDATE ask_usage SET count = count - 1 WHERE day = ? AND client = ? AND count > 0').bind(day, client).run();

  // 全站每日上限（保護 Gemini 免費額度）
  if (global > 0) {
    const g = await db
      .prepare(
        `INSERT INTO counters (key, value) VALUES (?1, 1)
         ON CONFLICT(key) DO UPDATE SET value = value + 1 WHERE value < ?2 RETURNING value`,
      )
      .bind(`ask_global_${day}`, global)
      .first();
    if (!g) {
      await refund();
      return json({ ok: false, reason: 'site_daily_cap', message: UNAVAILABLE, remaining: perUser - row.count + 1, limit: perUser });
    }
  }

  const subsidies = await listSubsidies(db);
  let result;
  if (!subsidies.length) {
    result = { ok: true, text: NO_ANSWER };
  } else {
    result = await askGemini(env, question, buildContext(subsidies));
  }
  if (!result.ok) {
    console.warn(`智慧小幫手暫停：${result.reason}`);
    await refund();
    return json({ ok: false, reason: 'ai_unavailable', message: UNAVAILABLE, remaining: perUser - row.count + 1, limit: perUser });
  }

  // 偶爾清除三天前的用量紀錄
  if (Math.random() < 0.05) {
    const old = taipeiDate(Date.now() - 3 * 86400000);
    await db.prepare('DELETE FROM ask_usage WHERE day < ?').bind(old).run();
    await db.prepare("DELETE FROM counters WHERE key LIKE 'ask_global_%' AND key < ?").bind(`ask_global_${old}`).run();
  }

  return json({
    ok: true,
    answer: sanitizeAnswer(result.text, subsidies.map((s) => s.official_url)),
    remaining: Math.max(0, perUser - row.count),
    limit: perUser,
  });
}
