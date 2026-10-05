// 前台與伺服器共用的時間、狀態、排序邏輯。
// 台灣沒有日光節約時間，Asia/Taipei 固定為 UTC+8，因此以固定位移計算，不受伺服器時區影響。

export const TAIPEI_OFFSET_MS = 8 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export const NEW_DAYS = 7;
export const HOT_DAYS = 7;

export const UNKNOWN = '官方未明載';

/** 以 Asia/Taipei 取得各時間欄位。 */
export function taipeiParts(ms = Date.now()) {
  const d = new Date(ms + TAIPEI_OFFSET_MS);
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes(),
    second: d.getUTCSeconds(),
  };
}

const pad = (n) => String(n).padStart(2, '0');

/** 'YYYY-MM-DD'（台灣日期） */
export function taipeiDate(ms = Date.now()) {
  const p = taipeiParts(ms);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

export function taipeiYear(ms = Date.now()) {
  return taipeiParts(ms).year;
}

/** YYYY/MM/DD HH:mm:ss */
export function formatDateTime(ms = Date.now(), withSeconds = true) {
  const p = taipeiParts(ms);
  const base = `${p.year}/${pad(p.month)}/${pad(p.day)} ${pad(p.hour)}:${pad(p.minute)}`;
  return withSeconds ? `${base}:${pad(p.second)}` : base;
}

/** 'YYYY-MM-DD' → 'YYYY/MM/DD' */
export function formatDate(iso) {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return UNKNOWN;
  return iso.replaceAll('-', '/');
}

function parseIsoDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
  if (!m) return null;
  return { y: +m[1], m: +m[2], d: +m[3] };
}

/** 台灣時間該日 00:00:00 的 epoch ms */
export function startOfTaipeiDay(iso) {
  const p = parseIsoDate(iso);
  if (!p) return null;
  return Date.UTC(p.y, p.m - 1, p.d, 0, 0, 0) - TAIPEI_OFFSET_MS;
}

/** 截止時間：有明確時間用該時間，否則為台灣時間該日 23:59:59 */
export function deadlineMs(iso, time) {
  const p = parseIsoDate(iso);
  if (!p) return null;
  const t = /^(\d{1,2}):(\d{2})$/.exec(time || '');
  if (t) return Date.UTC(p.y, p.m - 1, p.d, +t[1], +t[2], 0) - TAIPEI_OFFSET_MS;
  return Date.UTC(p.y, p.m - 1, p.d, 23, 59, 59, 999) - TAIPEI_OFFSET_MS;
}

/** 以台灣日曆計算兩個日期相差天數（b - a） */
export function calendarDaysBetween(isoA, isoB) {
  const a = startOfTaipeiDay(isoA);
  const b = startOfTaipeiDay(isoB);
  if (a == null || b == null) return null;
  return Math.round((b - a) / DAY_MS);
}

// 官方明示提前結束的狀態旗標
export const CLOSED_FLAGS = {
  quota_full: '已額滿',
  budget_exhausted: '經費用罄',
  closed_early: '提前截止',
  closed: '已停止受理',
};

export const STATUS = {
  open: { key: 'open', label: '申請中', light: '🟢' },
  upcoming: { key: 'upcoming', label: '尚未開始', light: '🟡' },
  closed: { key: 'closed', label: '已截止', light: '⚫' },
  unknown: { key: 'unknown', label: '期程請見官方公告', light: '⚪' },
};

/**
 * 計算補助狀態。
 * sub: { apply_start, apply_end, apply_end_time, status_flag, until_quota }
 */
export function computeStatus(sub, now = Date.now()) {
  if (sub.status_flag && CLOSED_FLAGS[sub.status_flag]) {
    return { ...STATUS.closed, reason: CLOSED_FLAGS[sub.status_flag] };
  }
  const end = deadlineMs(sub.apply_end, sub.apply_end_time);
  const start = startOfTaipeiDay(sub.apply_start);
  if (end != null && now > end) return { ...STATUS.closed };
  if (start != null && now < start) return { ...STATUS.upcoming };
  if (start != null || end != null) return { ...STATUS.open };
  return { ...STATUS.unknown };
}

/** 公告 7 天內（含當天）顯示 NEW */
export function isNew(sub, now = Date.now()) {
  if (!sub.announce_date) return false;
  const diff = calendarDaysBetween(sub.announce_date, taipeiDate(now));
  return diff != null && diff >= 0 && diff <= NEW_DAYS;
}

/**
 * 剩餘天數（只在申請中且有明確截止日時提供），否則回傳 null，不虛構天數。
 */
export function daysLeft(sub, now = Date.now()) {
  if (!sub.apply_end) return null;
  if (computeStatus(sub, now).key !== 'open') return null;
  return calendarDaysBetween(taipeiDate(now), sub.apply_end);
}

/** 🔥 即將截止資訊；不符合時回傳 null */
export function hotInfo(sub, now = Date.now()) {
  const left = daysLeft(sub, now);
  if (left == null || left < 0 || left > HOT_DAYS) return null;
  return { daysLeft: left, text: left === 0 ? '今天截止' : `剩餘 ${left} 天` };
}

const GROUP = { new: 0, open: 1, upcoming: 2, unknown: 3, closed: 4 };

/** 依規格排序：近 7 天新公告 → 申請中 → 尚未開始 →（期程未明）→ 已截止 */
export function sortSubsidies(list, now = Date.now()) {
  const decorated = list.map((s) => {
    const status = computeStatus(s, now);
    const fresh = isNew(s, now);
    return {
      s,
      group: fresh ? GROUP.new : GROUP[status.key],
      end: deadlineMs(s.apply_end, s.apply_end_time),
      start: startOfTaipeiDay(s.apply_start),
      ann: startOfTaipeiDay(s.announce_date) ?? 0,
    };
  });
  const byEndAsc = (a, b) => {
    if (a.end != null && b.end != null) return a.end - b.end;
    if (a.end != null) return -1;
    if (b.end != null) return 1;
    return b.ann - a.ann;
  };
  decorated.sort((a, b) => {
    if (a.group !== b.group) return a.group - b.group;
    switch (a.group) {
      case GROUP.new:
        return b.ann - a.ann || byEndAsc(a, b);
      case GROUP.closed: {
        // 最近截止者優先；官方提前結束而無截止日者，以公告日期排序
        const ae = a.end ?? a.ann;
        const be = b.end ?? b.ann;
        return be - ae;
      }
      default:
        return byEndAsc(a, b);
    }
  });
  return decorated.map((d) => d.s);
}

/** 補助期間文字 */
// 期間文字開頭的梯次（如「第四梯（暫定） 2026/11/02 ～ 11/30」）：梯次改以標籤呈現，期間只留日期
const PERIOD_BATCH = /^第\s*([一二三四五六七八九十\d]+)\s*梯次?\s*([（(]暫定[）)])?\s*/;

export function periodText(sub) {
  if (sub.period_text) {
    const m = PERIOD_BATCH.exec(sub.period_text);
    return m ? `${sub.period_text.slice(m[0].length)}${m[2] ? '（暫定）' : ''}` : sub.period_text;
  }
  const s = sub.apply_start ? formatDate(sub.apply_start) : null;
  let e = sub.apply_end ? formatDate(sub.apply_end) : null;
  if (e && sub.apply_end_time) e += ` ${sub.apply_end_time}`;
  if (s && e) return `${s} ～ ${e}${sub.period_varies ? '（依類別不同）' : ''}`;
  if (s && sub.until_quota) return `${s} 起（額滿為止）`;
  if (s) return `${s} 起（截止日${UNKNOWN}）`;
  if (e) return `至 ${e} 止`;
  if (sub.until_quota) return '額滿為止';
  return UNKNOWN;
}

export const TARGET_TYPES = [
  '製造業／工廠',
  '服務業／商業',
  '旅宿業',
  '醫療院所',
  '機關／學校',
  '住宅／一般民眾',
  '農漁畜牧業',
  '能源技術服務業（ESCO）',
  '其他',
];

// ---------- 顯示用：精簡名稱、標籤、補助對象分類 ----------

/** 補助對象 6 大類（顏色定義在 CSS：.cat-0 ~ .cat-5） */
export const CATEGORIES = ['服務業', '工業', '機關學校', '醫院／長照', '農業', '民眾'];

// 舊版分類名稱對照（舊資料重新整理前仍可正確顯示）
const LEGACY_CATEGORY = {
  '服務業／商業': '服務業', 旅宿業: '服務業', '能源技術服務業（ESCO）': '服務業',
  '製造業／工廠': '工業', '機關／學校': '機關學校', 醫療院所: '醫院／長照',
  '住宅／一般民眾': '民眾', 農漁畜牧業: '農業',
};

export function categoriesOf(sub) {
  const set = new Set((sub.target_types || []).map((t) => LEGACY_CATEGORY[t] || t));
  return CATEGORIES.filter((c) => set.has(c));
}

const CN_NUM = '一二三四五六七八九十';

/** 精簡名稱：取「」內的計畫名稱，去掉年度、公告用語、（修正版）、作業要點等 */
export function displayTitle(sub) {
  if (sub.display_title) return sub.display_title;
  const t = String(sub.title || '');
  const quoted = /[「『]([^」』]{4,60})[」』]/.exec(t);
  let name = quoted ? quoted[1] : sub.program_name || t;
  name = name
    .replace(/^\s*(\[[^\]]*\]|【[^】]*】)\s*/, '')
    .replace(/^(公告|修正|訂定|徵求)\s*/, '')
    .replace(/^(中華民國)?\s*(\d{2,4}|一百[零一二三四五六七八九十]{0,3})\s*(年度|年)\s*[-－–—:：]?\s*/, '')
    .replace(/[（(](修正版|已結束|已結束申請|更新版?)[）)]\s*$/, '')
    .replace(/(作業要點|補助要點|作業規範|申請須知|須知|相關規定公告|相關規定|公告)$/, '')
    .replace(/要點$/, '')
    // 沒有「」時：「動力與公用設備補助購買、受理申請期間…」→ 只留到補助名稱
    .replace(/(補助|獎勵|計畫|專案)(購買|受理|委託|申請|相關|、|之).*$/, '$1')
    .trim();
  return name || t;
}

/** 標題中的年度與梯次（例：116年度、第四梯次），以小標籤呈現 */
export function titleTags(sub) {
  const t = String(sub.title || '');
  const tags = [];
  const y = /(?<!\d)(\d{3})\s*(年度|年)/.exec(t);
  const cy = /一百(零)?(?:([一二三四五六七八九]?)十)?([一二三四五六七八九])?\s*(年度|年)/.exec(t);
  if (y) tags.push(`${y[1]}年度`);
  else if (cy) {
    const D = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
    const tens = /十/.test(cy[0]) ? (cy[2] ? D[cy[2]] : 1) : 0;
    tags.push(`${100 + tens * 10 + (cy[3] ? D[cy[3]] : 0)}年度`);
  }
  const b = /第\s*([一二三四五六七八九十\d]+)\s*(梯次|梯|次|期)/.exec(t) || PERIOD_BATCH.exec(sub.period_text || '');
  if (b) tags.push(`第${/^\d+$/.test(b[1]) ? CN_NUM[+b[1] - 1] || b[1] : b[1]}梯次`);
  return tags;
}

/** 補助對象原文 → 條列（依（一）（二）、第一類、1. 等標號拆分；只拆不改寫） */
export function targetPoints(sub) {
  if (Array.isArray(sub.target_points) && sub.target_points.length) return sub.target_points;
  const t = String(sub.target || '').replace(/…$/, '').trim();
  if (!t) return [];
  const parts = t
    .split(/\s*(?=[（(][一二三四五六七八九十]+[）)]|(?<![\d.])[1-9][.、](?!\d)|第[一二三四五六七八九十]+類(?!補助對象))/)
    .map((p) =>
      p
        .replace(/^[（(][一二三四五六七八九十]+[）)]\s*|^[1-9][.、]\s*/, '')
        .replace(/^(第[一二三四五六七八九十、及與]+類)\s*補助對象為/, '$1：')
        .trim(),
    )
    .filter((p) => p.length >= 2);
  return parts.slice(0, 8);
}
