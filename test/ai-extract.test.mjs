import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cnInt, normalizeNumbers, sanitizeFields, extractWithAI } from '../server/ai-extract.js';
import { applyOverrides } from '../server/data.js';

test('國字數字轉換：萬以下的常見寫法', () => {
  assert.equal(cnInt('一千五百'), 1500);
  assert.equal(cnInt('三十五'), 35);
  assert.equal(cnInt('十'), 10);
  assert.equal(cnInt('一百十五'), 115);
  assert.equal(normalizeNumbers('補助比率最高為百分之百，以三分之一為限，上限新臺幣五百萬元、1,500萬元'), '補助比率最高為100%，以1/3為限，上限新臺幣500萬元、1500萬元');
});

const SOURCE = '對受補助機關補助比率最高為百分之百。每案補助上限新臺幣五百萬元，節能率不得低於百分之十。違反者得處新臺幣五萬元以上罰鍰。';

test('AI 整理：數字都出自原文才採用', () => {
  const { fields, dropped } = sanitizeFields(
    { summary: '節能率須達 10% 以上', amount_text: '補助比率最高 100%', amount_details: ['每案上限新臺幣 500 萬元'], target_points: ['中央機關'] },
    SOURCE,
  );
  assert.equal(fields.amount_text, '補助比率最高 100%');
  assert.deepEqual(fields.amount_details, ['每案上限新臺幣 500 萬元']);
  assert.equal(fields.summary, '節能率須達 10% 以上');
  assert.equal(dropped.length, 0);
});

test('AI 整理：編造的數字整欄捨棄；金額明細有錯時最高補助一併不採用', () => {
  const { fields, dropped } = sanitizeFields(
    { summary: '最高補助 40%', amount_text: '最高新臺幣 500 萬元', amount_details: ['每案上限新臺幣 800 萬元'], target_points: [] },
    SOURCE,
  );
  assert.equal(fields.summary, null);
  assert.equal(fields.amount_text, null);
  assert.deepEqual(fields.amount_details, []);
  assert.ok(dropped.length >= 2);
});

test('AI 整理：Gemini 回傳 JSON 後經檢查才回傳；金鑰只在伺服器端', async () => {
  let sent;
  const fetchImpl = async (url, init) => {
    sent = { url, init };
    return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify({ summary: null, amount_text: '每案最高新臺幣 500 萬元', amount_details: [], target_points: [] }) }] } }] });
  };
  const r = await extractWithAI({ GEMINI_API_KEY: 'k', GEMINI_MODEL: 'm' }, { title: 't', agency: 'a', text: SOURCE }, { fetchImpl });
  assert.equal(r.ok, true);
  assert.equal(r.fields.amount_text, '每案最高新臺幣 500 萬元');
  assert.equal(JSON.parse(sent.init.body).generationConfig.responseMimeType, 'application/json');
  assert.ok(!sent.url.includes('key='));
  assert.equal(sent.init.headers['x-goog-api-key'], 'k');
});

test('顯示優先順序：人工整理 > AI 整理 > 規則擷取；沒有可靠金額時不顯示猜測的數字', () => {
  const ai = { summary: 'AI 重點', amount_text: 'AI 金額', amount_details: ['AI 明細'], target_points: ['AI 對象'] };
  const none = { overrides: new Map(), titleRules: [], excluded: new Set() };
  const a = applyOverrides({ id: 'x', title: 't', official_url: 'u', amount_text: '規則金額', summary: '規則重點', ai_fields: ai }, none);
  assert.equal(a.amount_text, 'AI 金額');
  assert.equal(a.summary, 'AI 重點');
  assert.deepEqual(a.target_points, ['AI 對象']);
  assert.ok(!('ai_fields' in a));
  const manual = { overrides: new Map([['x', { amount_text: '人工金額', summary: '人工重點' }]]), titleRules: [], excluded: new Set() };
  const b = applyOverrides({ id: 'x', title: 't', official_url: 'u', ai_fields: ai }, manual);
  assert.equal(b.amount_text, '人工金額');
  assert.equal(b.summary, '人工重點');
  assert.deepEqual(b.target_points, ['AI 對象']);
  const c = applyOverrides({ id: 'x', title: 't', official_url: 'u', amount_text: '規則金額', ai_fields: { ...ai, amount_text: null } }, none);
  assert.equal(c.amount_text, null);
  assert.ok(c.amount_unverified);
});
