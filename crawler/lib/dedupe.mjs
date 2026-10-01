// 補助去重：同一補助可能同時出現在最新消息、公告、補助專區、PDF。
import { createHash } from 'node:crypto';
import { normalizeText } from './dates.mjs';

export function sha1(s) {
  return createHash('sha1').update(String(s)).digest('hex');
}

const CN_NUM = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };

/** 梯次（第二梯次、第2次、第3期）視為不同的申請回合 */
export function extractBatch(title) {
  const m = /第\s*([一二三四五六七八九十\d]+)\s*(梯次|次|期|波)/.exec(normalizeText(title));
  if (!m) return '';
  return String(/^\d+$/.test(m[1]) ? +m[1] : CN_NUM[m[1]] ?? m[1]);
}

/** 正規化補助名稱：去除年度、公告用語、標點 */
export function normalizeName(title, programName = null) {
  let s = normalizeText(programName || title);
  // 標題中有「」時以引號內的計畫名稱為主
  if (!programName) {
    const q = /[「『]([^」』]{4,60})[」』]/.exec(s);
    if (q) s = q[1];
  }
  return s
    .replace(/(中華民國)?\s*\d{2,4}\s*[-~～至]?\s*\d{0,4}\s*(年度|年)/g, '')
    .replace(/第\s*[一二三四五六七八九十\d]+\s*(梯次|次|期|波)/g, '')
    .replace(/公告|修正|訂定|有關|本部|本署|本局|本會|辦理|受理申請|受理|申請作業|申請期間|申請|相關事宜|事宜|期間|即日起|開始|歡迎|踴躍|提案|作業要點|要點|須知|計畫書|格式|處所/g, '')
    .replace(/[\s\p{P}\p{S}]/gu, '')
    .toLowerCase();
}

/** 機關名稱根（經濟部能源署 與 經濟部 視為相關機關） */
export function agenciesRelated(a, b) {
  if (!a || !b) return false;
  return a === b || a.startsWith(b) || b.startsWith(a);
}

function bigrams(s) {
  const out = new Map();
  for (let i = 0; i < s.length - 1; i++) {
    const g = s.slice(i, i + 2);
    out.set(g, (out.get(g) || 0) + 1);
  }
  return out;
}

/** Dice 相似度 0~1 */
export function similarity(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const A = bigrams(a);
  const B = bigrams(b);
  let inter = 0;
  for (const [g, n] of A) inter += Math.min(n, B.get(g) || 0);
  const total = Math.max(1, a.length - 1 + b.length - 1);
  return (2 * inter) / total;
}

export function dedupeKey({ agency, year, title, program_name }) {
  return `${agency}|${year ?? ''}|${normalizeName(title, program_name)}|${extractBatch(title)}`;
}

export function idFromKey(key) {
  return sha1(key).slice(0, 12);
}

/**
 * 在既有補助中找出同一筆。
 * existing: [{ id, dedupe_key, agency, year, title, program_name, official_url, source_urls, doc_no }]
 */
export function findMatch(doc, existing) {
  const key = dedupeKey(doc);
  const urls = new Set([doc.official_url, ...(doc.source_urls || [])]);
  // 1) 相同網址
  for (const e of existing) {
    if (urls.has(e.official_url) || (e.source_urls || []).some((u) => urls.has(u))) return e;
  }
  // 2) 相同去重鍵
  const byKey = existing.find((e) => e.dedupe_key === key);
  if (byKey) return byKey;
  // 3) 相同發文字號
  if (doc.doc_no) {
    const byDoc = existing.find((e) => e.doc_no && e.doc_no === doc.doc_no);
    if (byDoc) return byDoc;
  }
  // 4) 相關機關、同年度、同梯次、名稱高度相似
  const name = normalizeName(doc.title, doc.program_name);
  const batch = extractBatch(doc.title);
  let best = null;
  let bestScore = 0;
  for (const e of existing) {
    if (!agenciesRelated(doc.agency, e.agency)) continue;
    if (doc.year && e.year && doc.year !== e.year) continue;
    // 沒有年度的計畫介紹頁可併入任一梯次的公告
    const undated = doc.year == null || e.year == null;
    if (!undated && extractBatch(e.title) !== batch) continue;
    const score = similarity(name, normalizeName(e.title, e.program_name));
    if (score > bestScore) {
      bestScore = score;
      best = e;
    }
  }
  return bestScore >= 0.72 ? best : null;
}
