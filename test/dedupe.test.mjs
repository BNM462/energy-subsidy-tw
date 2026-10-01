import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeName, extractBatch, findMatch, dedupeKey, idFromKey, similarity } from '../crawler/lib/dedupe.mjs';

test('正規化名稱：去除年度與公告用語，以「」內名稱為主', () => {
  const a = normalizeName('公告115年度「節能服務業獎勵」第二梯次受理申請期間、受理申請處所');
  const b = normalizeName('經濟部能源署公告116年度「節能服務業獎勵」即日起受理申請');
  assert.equal(a, b);
});

test('梯次辨識', () => {
  assert.equal(extractBatch('第二梯次受理'), '2');
  assert.equal(extractBatch('第2梯次'), '2');
  assert.equal(extractBatch('第3次補助受理'), '3');
  assert.equal(extractBatch('補助計畫'), '');
});

test('同一補助出現在公告與新聞：去重', () => {
  const existing = [{
    id: 'aaaaaaaaaaaa', agency: '經濟部能源署', year: 2026,
    title: '公告115年度「節能服務業獎勵」第二梯次受理申請期間、受理申請處所、節電專案有效期間與規範完工日、申請書及計畫書格式',
    official_url: 'https://www.moeaea.gov.tw/a', source_urls: [], dedupe_key: 'x',
  }];
  existing[0].dedupe_key = dedupeKey(existing[0]);
  // 不同網址、相關機關（經濟部 vs 經濟部能源署）、相似名稱
  const doc = { agency: '經濟部', year: 2026, title: '115年度「節能服務業獎勵」第二梯次 即日起受理申請', official_url: 'https://www.moea.gov.tw/b' };
  assert.equal(findMatch(doc, existing)?.id, 'aaaaaaaaaaaa');
  // 不同梯次不可合併
  const doc2 = { ...doc, title: '115年度「節能服務業獎勵」第一梯次受理申請' };
  assert.equal(findMatch(doc2, existing), null);
  // 不同年度不可合併
  const doc3 = { ...doc, year: 2027, title: '116年度「節能服務業獎勵」第二梯次受理申請' };
  assert.equal(findMatch(doc3, existing), null);
});

test('同網址：直接視為同一筆（官方內容更新時更新原資料）', () => {
  const existing = [{ id: 'bbbbbbbbbbbb', agency: 'X', year: 2026, title: '舊標題', official_url: 'https://x.gov.tw/1', source_urls: [], dedupe_key: 'k' }];
  assert.equal(findMatch({ agency: 'X', year: 2026, title: '完全不同的新標題', official_url: 'https://x.gov.tw/1' }, existing)?.id, 'bbbbbbbbbbbb');
});

test('不同補助不可誤合併', () => {
  const existing = [{ id: 'c', agency: '經濟部能源署', year: 2026, title: '公告116年度「廢熱與廢冷回收技術示範應用專案」第2梯次受理申請補助期間', official_url: 'u1', source_urls: [], dedupe_key: 'k1' }];
  const doc = { agency: '經濟部能源署', year: 2026, title: '公告115年度「節能服務業獎勵」第二梯次受理申請期間', official_url: 'u2' };
  assert.equal(findMatch(doc, existing), null);
});

test('ID 穩定', () => {
  const k = dedupeKey({ agency: 'A', year: 2026, title: '「某補助」' });
  assert.equal(idFromKey(k), idFromKey(k));
  assert.match(idFromKey(k), /^[a-f0-9]{12}$/);
  assert.ok(similarity('節能服務業獎勵', '節能服務業獎勵') === 1);
});
