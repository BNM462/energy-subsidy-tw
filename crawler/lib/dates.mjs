// 民國／西元日期解析與申請期間擷取。
// 原則：抓不到明確日期就回傳 null，不推測。

const FULLWIDTH = /[０-９／．－：～]/g;
const FW_MAP = { '／': '/', '．': '.', '－': '-', '：': ':', '～': '~' };

/**
 * 全形數字、符號轉半形，並統一空白。
 * NFKC 會把外觀相同的「相容表意字」（例：衛福部網頁中的「年」U+F98E）轉為標準字（U+5E74）。
 */
export function normalizeText(s) {
  return String(s ?? '')
    // 只轉換相容表意字與康熙部首，保留官方原文的全形標點
    .replace(/[⺀-⿟豈-﫿]|[\u{2F800}-\u{2FA1F}]/gu, (c) => c.normalize('NFKC'))
    .replace(FULLWIDTH, (c) => FW_MAP[c] ?? String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[ 　\t]+/g, ' ')
    .replace(/\r/g, '');
}

const pad = (n) => String(n).padStart(2, '0');

export function isValidDate(y, m, d) {
  if (!(y >= 1990 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31)) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** 年份：3 位數以下視為民國年（+1911），4 位數視為西元年 */
export function toAdYear(raw) {
  const y = parseInt(raw, 10);
  if (!Number.isFinite(y)) return null;
  if (String(raw).length === 4) return y;
  if (y >= 70 && y <= 200) return y + 1911;
  return null;
}

export function iso(y, m, d) {
  return isValidDate(y, m, d) ? `${y}-${pad(m)}-${pad(d)}` : null;
}

// 年 月 日 (例：115年9月11日、中華民國115年09月11日、2026年9月11日)
const RE_CJK = /(?:中華民國|民國|西元)?\s*(\d{2,4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/g;
// 分隔符號 (例：115/09/11、115.09.11、115-09-11、2026/9/11)
const RE_SEP = /(?<![\d.])(\d{2,4})\s*([/.\-])\s*(\d{1,2})\s*\2\s*(\d{1,2})(?![\d.])/g;
// 只有月日 (例：9月30日)，年份需由上下文提供
const RE_MD = /(?<![\d年])(\d{1,2})\s*月\s*(\d{1,2})\s*日/g;

/**
 * 找出文字中所有完整日期（含年份），回傳 [{ iso, index, end, raw }]
 */
export function findDates(text) {
  const t = normalizeText(text);
  const out = [];
  for (const re of [RE_CJK, RE_SEP]) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(t))) {
      const isSep = re === RE_SEP;
      const y = toAdYear(m[1]);
      const mo = +(isSep ? m[3] : m[2]);
      const d = +(isSep ? m[4] : m[3]);
      const v = y && iso(y, mo, d);
      if (v) out.push({ iso: v, index: m.index, end: m.index + m[0].length, raw: m[0] });
    }
  }
  out.sort((a, b) => a.index - b.index);
  // 去除重疊
  const res = [];
  for (const d of out) if (!res.length || d.index >= res[res.length - 1].end) res.push(d);
  return res;
}

/** 解析單一日期字串（第一個找到的日期） */
export function parseDate(text) {
  return findDates(text)[0]?.iso ?? null;
}

// 申請期間標籤
const PERIOD_LABEL =
  /(申請補助期間|補助申請期間|受理補助申請期間|申請受理期間|申請期間|受理期間|受理申請期間|收件期間|申請時間|受理時間|收件時間|申請日期|受理日期|徵件期間|申請收件期間|計畫申請期間|申請截止|收件截止|截止收件|截止日期|申請期限|受理期限|開放申請|受理申請)/g;

const UNTIL_QUOTA = /額滿為止|額滿即止|額滿截止|用罄為止|經費用(罄|完)為止|預算用(罄|完)為止|額滿即停止|用罄即停止/;
const FLAG_PATTERNS = [
  ['budget_exhausted', /(經費|預算|補助款)(已)?(全數|全部)?(用罄|用完|告罄|使用完畢)(?!為止|即)/],
  ['quota_full', /(已|業已|目前已)額滿|申請額度已滿|名額已滿/],
  ['closed_early', /提前(截止|結束|停止)(受理|收件|申請)?/],
  ['closed', /(已|即日起)停止(受理|收件)/],
];

// 假設語氣（例：「如經費即將用罄，本署得公告提前截止」）不是實際狀態
const CONDITIONAL_BEFORE = /(得|如|若|倘|將|即將|可能|預計|視|恐|或|應|必要時)[^，。；\n]{0,12}$/;

// 同一句中出現這些字，代表是規定或假設（「如經費即將用罄，得公告提前截止」），不是已經發生
const CONDITIONAL_IN_SENTENCE = /(如|若|倘|得|即將|可能|預計|視|必要時|屆時|將視)/;
// 緊接在後面的字代表假設或原則（「經費用罄時」「至經費用罄為原則」）
const CONDITIONAL_AFTER = /^(時|者|為止|為原則|為限|前|後|即|則)/;

/** 官方明示的結束狀態（只採用已經發生的敘述） */
export function detectStatusFlag(text) {
  const t = normalizeText(text);
  for (const [flag, re] of FLAG_PATTERNS) {
    const g = new RegExp(re.source, 'g');
    let m;
    while ((m = g.exec(t))) {
      const sentenceBefore = t.slice(Math.max(0, m.index - 80), m.index).split(/[。；;\n]/).pop();
      const after = t.slice(m.index + m[0].length, m.index + m[0].length + 4);
      const actual = /已/.test(sentenceBefore + m[0]);
      if (CONDITIONAL_AFTER.test(after)) continue;
      if (!actual && (CONDITIONAL_BEFORE.test(t.slice(Math.max(0, m.index - 14), m.index)) || CONDITIONAL_IN_SENTENCE.test(sentenceBefore))) continue;
      return flag;
    }
  }
  return null;
}

export function detectUntilQuota(text) {
  return UNTIL_QUOTA.test(normalizeText(text));
}

// 時間 (例：下午5時、17時、17:00、下午5點30分)
function parseTime(s) {
  const t = normalizeText(s);
  let m = /(上午|下午|中午|晚上)?\s*(\d{1,2})\s*[時点點:](\s*(\d{1,2})\s*分?)?/.exec(t);
  if (!m) return null;
  let h = +m[2];
  const min = m[4] ? +m[4] : 0;
  if ((m[1] === '下午' || m[1] === '晚上') && h < 12) h += 12;
  if (m[1] === '中午' && h < 12) h = 12;
  if (h > 23 || min > 59) return null;
  return `${pad(h)}:${pad(min)}`;
}

/**
 * 從內文擷取申請期間。
 * 回傳 { start, end, endTime, rawText, untilQuota, fromToday }，抓不到的欄位為 null。
 * announceDate 只用於官方明寫「即日起」時作為開始日。
 */
// 「即日起」「公告日起」「自公告之日起」都代表從公告日開始
const FROM_TODAY = /即日起|(自)?公告(之)?日起/;
// 不是「申請」期間的期間（執行、輔導、委託、結案、購買…），不可當成受理申請期間
const NON_APPLY = /(執行期程|執行期間|輔導期程|計畫期程|計畫期間|委託期間|結案|完工|有效期間|購買期間|購置期間|回收證明|訓練期間|活動期間|履約|保固|竣工|專案期程)/;

export function extractPeriod(text, { announceDate = null } = {}) {
  const t = normalizeText(text);
  const result = { start: null, end: null, endTime: null, rawText: null, untilQuota: false, fromToday: false, varies: false };
  const candidates = [];
  PERIOD_LABEL.lastIndex = 0;
  let m;
  while ((m = PERIOD_LABEL.exec(t))) {
    const labelEnd = m.index + m[0].length;
    // 只採用「標籤：內容」形式（標題中的「受理申請期間、受理申請處所」不算）
    if (!/^\s*([:：]|自|即日起|公告|為|於|至|起|\d)/.test(t.slice(labelEnd, labelEnd + 4))) continue;
    const lineEnd = t.indexOf('\n', labelEnd);
    let seg = t.slice(m.index, lineEnd === -1 ? m.index + 200 : lineEnd);
    if (!/\d|即日起|公告日/.test(seg.slice(m[0].length))) {
      // 標籤後同一行沒有日期：可能是分類別的多個期間（例：(一)第一類…至10/15；(二)第三類…至11/30）
      const subs = t.slice(labelEnd).split('\n').slice(1, 6);
      const items = [];
      for (const line of subs) {
        if (!/^\s*([（(][一二三四五六七八九十\d]+[)）]|\d+[.、]|第[一二三四五]類)/.test(line) || !/\d/.test(line)) break;
        items.push(line.trim());
      }
      if (items.length >= 2) {
        candidates.push({ multi: items });
        continue;
      }
      seg = t.slice(m.index, m.index + 200).split('\n').slice(0, 2).join(' ');
    }
    candidates.push({ seg: seg.slice(0, 220) });
  }
  // 沒有標籤時，找「自…起至…止」「即日起至…」句型（排除執行、委託、結案等非申請期間）
  // 例：「於115/8/17~115/9/16受理申請」
  const generic = /(自|即日起|於)[^。\n]{0,40}?(至|到|~|～|－|迄)[^。\n]{0,40}?(止|為止|截止|受理|收件)/g;
  while ((m = generic.exec(t))) {
    const before = t.slice(Math.max(0, m.index - 30), m.index);
    const body = m[0];
    // 期間標籤可能在上一行（例：「執行期程\n自輔導計畫通過申請日起至…」），因此只以句號切分
    if (NON_APPLY.test(before.split(/。/).pop() + body)) continue;
    candidates.push({ seg: t.slice(m.index, m.index + m[0].length + 20) });
  }

  for (const c of candidates) {
    if (c.multi) {
      const parts = c.multi.map((line) => parseSentence(line, announceDate)).filter(Boolean);
      if (parts.length < 2) continue;
      const ends = parts.map((p) => p.end).filter(Boolean).sort();
      const starts = parts.map((p) => p.start).filter(Boolean).sort();
      result.start = starts[0] || null;
      result.end = ends[ends.length - 1] || null;
      const last = parts.find((p) => p.end === result.end);
      result.endTime = last?.endTime || null;
      result.fromToday = parts.some((p) => p.fromToday);
      result.varies = new Set(ends).size > 1;
      result.rawText = c.multi.map((l) => l.replace(/^\s*[（(][一二三四五六七八九十\d]+[)）]\s*/, '').replace(/[。；;]+$/, '')).join('；').slice(0, 220);
      break;
    }
    const sentence = c.seg.split(/[。；;]/)[0];
    const p = parseSentence(sentence, announceDate);
    if (!p) continue;
    Object.assign(result, p);
    result.rawText = sentence.replace(/\s+/g, ' ').trim().slice(0, 140);
    break;
  }
  result.untilQuota = detectUntilQuota(t);
  return result;
}

/** 解析單一句子中的申請期間；無法判斷時回傳 null */
function parseSentence(sentence, announceDate) {
  const result = { start: null, end: null, endTime: null, fromToday: false };
  {
    const dates = findDates(sentence);
    const fromToday = FROM_TODAY.test(sentence);
    // 只有月日的結束日：以同句已知年份補上（僅同句內有年份時）
    if (dates.length === 1 && !fromToday) {
      const rest = sentence.slice(dates[0].end);
      const md = new RegExp(RE_MD.source).exec(rest);
      const sepIdx = /(至|到|~|-|－|迄)/.exec(rest);
      if (md && sepIdx && sepIdx.index < md.index) {
        const y = +dates[0].iso.slice(0, 4);
        const e = iso(y, +md[1], +md[2]);
        if (e && e >= dates[0].iso) dates.push({ iso: e, index: dates[0].end + md.index, end: dates[0].end + md.index + md[0].length, raw: md[0] });
      }
    }
    if (!dates.length && !fromToday) return null;

    const isDeadlineOnly = /截止|期限|前(送達|提出|寄達|申請)|為止|止$/.test(sentence) && dates.length === 1 && !/(至|到|~|迄)/.test(sentence.slice(0, dates[0].index));
    // 起訖必須是以「至／~／到／迄」相連的兩個日期（避免把發布日期當成開始日）
    let pair = null;
    for (let i = 0; i + 1 < dates.length && !pair; i++) {
      const gap = sentence.slice(dates[i].end, dates[i + 1].index);
      if (gap.length <= 24 && /(至|到|~|迄|－|-)/.test(gap) && !/[。；]/.test(gap)) pair = [dates[i], dates[i + 1]];
    }
    if (pair) {
      result.start = pair[0].iso;
      result.end = pair[1].iso;
      result.endTime = parseTime(sentence.slice(pair[1].end, pair[1].end + 15));
    } else if (dates.length >= 2 && !fromToday) {
      return null;
    } else if (fromToday && dates.length >= 1) {
      result.fromToday = true;
      result.start = announceDate;
      result.end = dates[0].iso;
      result.endTime = parseTime(sentence.slice(dates[0].end, dates[0].end + 15));
    } else if (dates.length === 1 && (isDeadlineOnly || /(至|到|~|迄).{0,6}$/.test(sentence.slice(0, dates[0].index)))) {
      result.end = dates[0].iso;
      result.endTime = parseTime(sentence.slice(dates[0].end, dates[0].end + 15));
    } else if (dates.length === 1 && /起/.test(sentence.slice(dates[0].end, dates[0].end + 4))) {
      result.start = dates[0].iso;
    } else if (fromToday) {
      result.fromToday = true;
      result.start = announceDate;
    } else {
      return null;
    }
    if (result.start && result.end && result.start > result.end) {
      result.start = null; // 日期順序不合理時不採用開始日
    }
  }
  return result;
}

/** 從文字中找「公告日期／發布日期」 */
export function extractAnnounceDate(text) {
  const t = normalizeText(text);
  const m = /(發布日期|發佈日期|公告日期|發文日期|上稿日期|上版日期|刊登日期|張貼日期|公布日期|發布時間|發佈時間|公告時間)\s*[:：]?\s*/g;
  let x;
  while ((x = m.exec(t))) {
    const d = findDates(t.slice(x.index, x.index + 40))[0];
    if (d) return d.iso;
  }
  // 公文格式：「經濟部能源署 公告」下一行單獨一行的日期（例：中華民國115年2月6日）
  const head = t.split('\n').slice(0, 8);
  for (let i = 0; i < head.length; i++) {
    if (!/公告\s*$/.test(head[i])) continue;
    const next = (head[i + 1] || '').trim();
    if (/^(中華民國)?\s*\d{2,4}\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*日$/.test(next)) return findDates(next)[0]?.iso ?? null;
  }
  return null;
}
