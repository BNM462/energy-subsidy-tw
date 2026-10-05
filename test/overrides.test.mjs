import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyOverrides, carriedOver } from '../server/data.js';

test('去年公告、今年仍受理：顯示；去年已結束：不顯示', () => {
  // 住宅家電汰舊換新：114/12/31 公告，受理至 116/01/31
  assert.ok(carriedOver({ year: 2025, apply_end: '2027-01-31' }, 2026));
  assert.ok(!carriedOver({ year: 2025, apply_end: '2025-11-30' }, 2026));
  assert.ok(carriedOver({ year: 2025, until_quota: true }, 2026), '額滿為止且未宣告結束');
  assert.ok(!carriedOver({ year: 2025, until_quota: true, status_flag: 'budget_exhausted' }, 2026));
  assert.ok(!carriedOver({ year: 2025 }, 2026), '沒有期程資訊不推測');
  assert.ok(!carriedOver({ year: 2024, apply_end: '2027-01-01' }, 2026), '只往前看一年');
});

const base = { id: 'abc123def456', title: '錯誤標題', official_url: 'https://x.gov.tw/1', apply_end: '2026-10-01', year: 2026 };

test('人工修正：以編號覆寫欄位，未列欄位保留爬蟲結果', () => {
  const ov = { overrides: new Map([['abc123def456', { title: '正確標題', apply_end: '2026-11-30' }]]), excluded: new Set() };
  const r = applyOverrides(base, ov);
  assert.equal(r.title, '正確標題');
  assert.equal(r.apply_end, '2026-11-30');
  assert.equal(r.official_url, 'https://x.gov.tw/1');
  assert.ok(r.manual);
});

test('人工修正：以官方網址覆寫；修正公告日期會同步年度', () => {
  const ov = { overrides: new Map([['https://x.gov.tw/1', { announce_date: '2027-01-05' }]]), excluded: new Set() };
  assert.equal(applyOverrides(base, ov).year, 2027);
});

test('人工修正不可覆寫非允許欄位（如瀏覽次數、編號）', () => {
  const ov = { overrides: new Map([['abc123def456', { id: 'hacked', views: 999999 }]]), excluded: new Set() };
  const r = applyOverrides({ ...base, views: 3 }, ov);
  assert.equal(r.id, 'abc123def456');
  assert.equal(r.views, 3);
});

test('人工排除：以編號或網址永久隱藏', () => {
  assert.equal(applyOverrides(base, { overrides: new Map(), excluded: new Set(['abc123def456']) }), null);
  assert.equal(applyOverrides(base, { overrides: new Map(), excluded: new Set(['https://x.gov.tw/1']) }), null);
  assert.equal(applyOverrides(base, { overrides: new Map([['abc123def456', { hidden: true }]]), excluded: new Set() }), null);
});

test('依名稱套用（title:）：同計畫的各梯次、新年度都適用；個別設定優先', () => {
  const ov = {
    overrides: new Map([['https://x.gov.tw/2', { summary: '個別設定' }]]),
    titleRules: [{ re: /節能服務業獎勵/, data: { amount_text: '按節能成效計算獎勵金（詳官網）', summary: '名稱規則' } }],
    excluded: new Set(),
  };
  const a = applyOverrides({ id: 'a', title: '公告116年度「節能服務業獎勵」第一梯次受理申請', official_url: 'https://x.gov.tw/1' }, ov);
  assert.equal(a.amount_text, '按節能成效計算獎勵金（詳官網）');
  assert.equal(a.summary, '名稱規則');
  const b = applyOverrides({ id: 'b', title: '115年度「節能服務業獎勵」第二梯次', official_url: 'https://x.gov.tw/2' }, ov);
  assert.equal(b.summary, '個別設定');
  assert.equal(b.amount_text, '按節能成效計算獎勵金（詳官網）');
  assert.equal(applyOverrides({ id: 'c', title: '其他補助', official_url: 'u' }, ov).manual, undefined);
});

test('金額：沒有人工核對的金額不顯示；依名稱套用的金額只適用於核對過的年度', () => {
  const none = { overrides: new Map(), titleRules: [], excluded: new Set() };
  const r = applyOverrides({ ...base, amount_text: '最高新臺幣 10 萬元', amount_details: ['得處新臺幣5萬元'] }, none);
  assert.equal(r.amount_text, null);
  assert.deepEqual(r.amount_details, []);
  assert.ok(r.amount_unverified);
  const ov = { overrides: new Map(), titleRules: [{ re: /動力與公用設備/, data: { amount_text: '每年最高 500 萬元', amount_year: 2026, summary: '說明' } }], excluded: new Set() };
  const y115 = applyOverrides({ id: 'a', title: '115年度「動力與公用設備補助」', official_url: 'u1', year: 2026 }, ov);
  assert.equal(y115.amount_text, '每年最高 500 萬元');
  assert.ok(!y115.amount_unverified);
  const y116 = applyOverrides({ id: 'b', title: '116年度「動力與公用設備補助」', official_url: 'u2', year: 2027, amount_text: '自動擷取' }, ov);
  assert.equal(y116.amount_text, null, '新年度金額未核對前不沿用');
  assert.ok(y116.amount_unverified);
  assert.equal(y116.summary, '說明');
});
