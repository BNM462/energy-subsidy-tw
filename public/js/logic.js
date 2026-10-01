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
export function periodText(sub) {
  const s = sub.apply_start ? formatDate(sub.apply_start) : null;
  let e = sub.apply_end ? formatDate(sub.apply_end) : null;
  if (e && sub.apply_end_time) e += ` ${sub.apply_end_time}`;
  if (s && e) return `${s} ～ ${e}`;
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
