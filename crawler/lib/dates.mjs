// 民國／西元日期解析與申請期間擷取。
// 原則：抓不到明確日期就回傳 null，不推測。

const FULLWIDTH = /[０-９／．－：～]/g;
const FW_MAP = { '／': '/', '．': '.', '－': '-', '：': ':', '～': '~' };

/** 全形數字、符號轉半形，並統一空白 */
export function normalizeText(s) {
  return String(s ?? '')
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
  /(申請期間|受理期間|受理申請期間|收件期間|申請時間|受理時間|收件時間|申請日期|受理日期|徵件期間|申請收件期間|計畫申請期間|申請截止|收件截止|截止收件|截止日期|申請期限|受理期限|開放申請|受理申請)/g;

const UNTIL_QUOTA = /額滿為止|額滿即止|額滿截止|用罄為止|經費用(罄|完)為止|預算用(罄|完)為止|額滿即停止|用罄即停止/;
const FLAG_PATTERNS = [
  ['budget_exhausted', /(經費|預算|補助款)(已)?(用罄|用完|告罄|使用完畢)(?!為止|即)/],
  ['quota_full', /(已|業已|目前已)額滿|申請額度已滿|名額已滿/],
  ['closed_early', /提前(截止|結束|停止)(受理|收件|申請)?/],
  ['closed', /(已|即日起)停止(受理|收件)/],
];

// 假設語氣（例：「如經費即將用罄，本署得公告提前截止」）不是實際狀態
const CONDITIONAL_BEFORE = /(得|如|若|倘|將|即將|可能|預計|視|恐|或|應|必要時)[^，。；\n]{0,12}$/;

/** 官方明示的結束狀態 */
export function detectStatusFlag(text) {
  const t = normalizeText(text);
  for (const [flag, re] of FLAG_PATTERNS) {
    const g = new RegExp(re.source, 'g');
    let m;
    while ((m = g.exec(t))) {
      const before = t.slice(Math.max(0, m.index - 14), m.index);
      if (!CONDITIONAL_BEFORE.test(before)) return flag;
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
export function extractPeriod(text, { announceDate = null } = {}) {
  const t = normalizeText(text);
  const result = { start: null, end: null, endTime: null, rawText: null, untilQuota: false, fromToday: false };
  const candidates = [];
  PERIOD_LABEL.lastIndex = 0;
  let m;
  while ((m = PERIOD_LABEL.exec(t))) {
    const labelEnd = m.index + m[0].length;
    // 只採用「標籤：內容」形式（標題中的「受理申請期間、受理申請處所」不算）
    if (!/^\s*([:：]|自|即日起|為|於|至|起|\d)/.test(t.slice(labelEnd, labelEnd + 4))) continue;
    const lineEnd = t.indexOf('\n', labelEnd);
    let seg = t.slice(m.index, lineEnd === -1 ? m.index + 200 : lineEnd);
    // 標籤後同一行沒有日期時，接續下一行（例：「申請期間：\n115年…」）
    if (!/\d|即日起/.test(seg.slice(m[0].length))) seg = t.slice(m.index, m.index + 200).split('\n').slice(0, 2).join(' ');
    candidates.push(seg.slice(0, 220));
  }
  // 沒有標籤時，找「自…起至…止」「即日起至…」句型
  const generic = /(自|即日起|於)[^。\n]{0,40}?(至|到|~|～|－|迄)[^。\n]{0,40}?(止|為止|截止)/g;
  while ((m = generic.exec(t))) candidates.push(t.slice(m.index, m.index + m[0].length + 20));

  for (const seg of candidates) {
    const sentence = seg.split(/[。；;]/)[0];
    const dates = findDates(sentence);
    const fromToday = /即日起/.test(sentence);
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
    if (!dates.length && !fromToday) continue;

    const isDeadlineOnly = /截止|期限|前(送達|提出|寄達|申請)|為止|止$/.test(sentence) && dates.length === 1 && !/(至|到|~|迄)/.test(sentence.slice(0, dates[0].index));
    if (dates.length >= 2) {
      result.start = dates[0].iso;
      result.end = dates[1].iso;
      result.endTime = parseTime(sentence.slice(dates[1].end, dates[1].end + 15));
    } else if (fromToday && dates.length === 1) {
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
      continue;
    }
    if (result.start && result.end && result.start > result.end) {
      result.start = null; // 日期順序不合理時不採用開始日
    }
    result.rawText = sentence.replace(/\s+/g, ' ').trim().slice(0, 140);
    break;
  }
  result.untilQuota = detectUntilQuota(t);
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
  return null;
}
