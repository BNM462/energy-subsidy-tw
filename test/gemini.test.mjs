import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeAnswer, dailyClientId, buildContext, askGemini, cleanQuestion, NO_ANSWER } from '../server/gemini.js';
import { validateIngest } from '../server/ingest-validate.js';
import { safeEqual, isAllowedOrigin, checkInternalAuth } from '../server/http.js';

test('回答中不屬於本站資料的網址會被移除', () => {
  const out = sanitizeAnswer('請見 https://a.gov.tw/1。另見 https://fake.example.com/x', ['https://a.gov.tw/1']);
  assert.ok(out.includes('https://a.gov.tw/1'));
  assert.ok(!out.includes('fake.example.com'));
});

test('每日匿名識別碼：換日即不同、不含原始 IP', async () => {
  const a = await dailyClientId('secret', '2026-10-01', '203.0.113.5');
  const b = await dailyClientId('secret', '2026-10-02', '203.0.113.5');
  const c = await dailyClientId('secret', '2026-10-01', '203.0.113.6');
  assert.notEqual(a, b, '換日後識別碼改變 → 額度重新計算');
  assert.notEqual(a, c);
  assert.ok(!a.includes('203'));
  assert.match(a, /^[a-f0-9]{32}$/);
});

test('沒有 API Key 時不呼叫 Gemini', async () => {
  let called = false;
  const r = await askGemini({ GEMINI_MODEL: 'm' }, 'q', 'ctx', { fetchImpl: async () => { called = true; } });
  assert.equal(r.ok, false);
  assert.equal(called, false);
});

test('免費額度用完（429）：回報無法使用，不丟出錯誤', async () => {
  const r = await askGemini({ GEMINI_API_KEY: 'k', GEMINI_MODEL: 'm', GEMINI_FALLBACK_MODEL: 'm2' }, 'q', 'ctx', {
    fetchImpl: async () => new Response('{}', { status: 429 }),
  });
  assert.deepEqual(r, { ok: false, reason: 'api_error' });
});

test('主要模型下架時改用備援模型', async () => {
  const r = await askGemini({ GEMINI_API_KEY: 'k', GEMINI_MODEL: 'old', GEMINI_FALLBACK_MODEL: 'new' }, 'q', 'ctx', {
    fetchImpl: async (url) =>
      url.includes('/old:') ? new Response('{}', { status: 404 }) : Response.json({ candidates: [{ content: { parts: [{ text: '答' }] } }] }),
  });
  assert.equal(r.ok, true);
  assert.equal(r.model, 'new');
});

test('API Key 只放在 header，不出現在網址', async () => {
  let seenUrl = '';
  let seenKey = '';
  await askGemini({ GEMINI_API_KEY: 'SECRET123', GEMINI_MODEL: 'm' }, 'q', 'ctx', {
    fetchImpl: async (url, init) => {
      seenUrl = url;
      seenKey = init.headers['x-goog-api-key'];
      return new Response('{}', { status: 500 });
    },
  });
  assert.ok(!seenUrl.includes('SECRET123'));
  assert.equal(seenKey, 'SECRET123');
});

test('Q&A 內容只含本站資料欄位，未明載者標示官方未明載', () => {
  const ctx = buildContext([{ id: 'a', title: '某補助', agency: '經濟部能源署', announce_date: '2026-09-01', official_url: 'https://x.gov.tw/1' }], Date.parse('2026-10-01T10:00:00+08:00'));
  assert.ok(ctx.includes('官方網址：https://x.gov.tw/1'));
  assert.ok(ctx.includes('補助金額：官方未明載'));
  assert.ok(NO_ANSWER.includes('沒有找到'));
});

test('問題清理：去除控制字元', () => {
  assert.equal(cleanQuestion(' 你好\u0000\n 補助 '), '你好 補助');
});

test('寫入 API：驗證格式、拒絕非 http 網址', () => {
  const base = { scan: { started_at: 'a', finished_at: 'b' } };
  assert.throws(() => validateIngest({ ...base, upserts: [{ id: 'abcdef123456', dedupe_key: 'k', title: 't', agency: 'a', official_url: 'javascript:alert(1)', first_seen_at: 'x', updated_at: 'y' }] }));
  assert.throws(() => validateIngest({ ...base, upserts: [{ id: '../../etc', dedupe_key: 'k', title: 't', agency: 'a', official_url: 'https://x.gov.tw', first_seen_at: 'x', updated_at: 'y' }] }));
  const ok = validateIngest({ ...base, upserts: [{ id: 'abcdef123456', dedupe_key: 'k', title: 't'.repeat(999), agency: 'a', official_url: 'https://x.gov.tw/1', first_seen_at: 'x', updated_at: 'y', status_flag: 'hacked' }] });
  assert.equal(ok.upserts[0].title.length, 300);
  assert.equal(ok.upserts[0].status_flag, null);
});

test('內部 API 驗證：沒有或錯誤的密鑰一律拒絕', () => {
  const env = { INGEST_TOKEN: 'x'.repeat(64) };
  const req = (h) => new Request('https://s/api/internal/state', { headers: h });
  assert.ok(!checkInternalAuth(req({}), env));
  assert.ok(!checkInternalAuth(req({ authorization: 'Bearer wrong' }), env));
  assert.ok(checkInternalAuth(req({ authorization: `Bearer ${'x'.repeat(64)}` }), env));
  assert.ok(!checkInternalAuth(req({ authorization: 'Bearer ' }), { INGEST_TOKEN: '' }), '未設定密鑰時一律拒絕');
  assert.ok(safeEqual('abc', 'abc') && !safeEqual('abc', 'abd'));
});

test('CORS 來源限制', () => {
  const env = { ALLOWED_ORIGINS: 'https://energy-subsidy-tw.pages.dev,https://*.energy-subsidy-tw.pages.dev' };
  assert.ok(isAllowedOrigin('https://energy-subsidy-tw.pages.dev', env));
  assert.ok(isAllowedOrigin('https://abc123.energy-subsidy-tw.pages.dev', env));
  assert.ok(!isAllowedOrigin('https://evil.com', env));
  assert.ok(!isAllowedOrigin('https://energy-subsidy-tw.pages.dev.evil.com', env));
  assert.ok(!isAllowedOrigin(null, env));
});
