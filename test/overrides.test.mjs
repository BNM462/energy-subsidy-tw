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
