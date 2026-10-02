import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findMatch } from '../crawler/lib/dedupe.mjs';

test('重點監測計畫：優先以固定身分對應，不會搶走其他紀錄的網址', () => {
  const existing = [
    { id: 'old', dedupe_key: '經濟部產業發展署||產業競爭力輔導團|', official_url: 'https://eii.nat.gov.tw/moeai-plus/' },
    { id: 'prog', dedupe_key: 'program:moeai-plus', official_url: 'https://eii.nat.gov.tw/moeai-plus/' },
  ];
  const doc = { dedupe_key: 'program:moeai-plus', official_url: 'https://eii.nat.gov.tw/moeai-plus/' };
  assert.equal(findMatch(doc, existing).id, 'prog');
});
