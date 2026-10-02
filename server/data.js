// 讀取補助資料並套用人工修正／排除。
import { taipeiYear } from '../public/js/logic.js';

const JSON_FIELDS = ['target_types', 'amount_details', 'source_urls', 'attachments', 'signals'];

// 人工修正可覆寫的欄位
export const OVERRIDABLE = [
  'title', 'agency', 'announce_date', 'apply_start', 'apply_end', 'apply_end_time', 'deadline_text',
  'until_quota', 'status_flag', 'target', 'target_types', 'amount_text', 'amount_details', 'summary',
  'content', 'official_url', 'hidden', 'delegate', 'display_title', 'target_points', 'ongoing', 'period_text',
];

function parseRow(row) {
  const out = { ...row };
  for (const f of JSON_FIELDS) {
    try {
      out[f] = JSON.parse(row[f] || '[]');
    } catch {
      out[f] = [];
    }
  }
  out.until_quota = !!row.until_quota;
  return out;
}

export async function loadOverrides(db) {
  const [ov, ex] = await db.batch([
    db.prepare('SELECT target, data FROM overrides'),
    db.prepare('SELECT target FROM exclusions'),
  ]);
  const overrides = new Map();
  for (const r of ov.results) {
    try {
      overrides.set(r.target, JSON.parse(r.data));
    } catch {
      /* 格式錯誤的修正略過 */
    }
  }
  return { overrides, excluded: new Set(ex.results.map((r) => r.target)) };
}

export function applyOverrides(sub, { overrides, excluded }) {
  if (excluded.has(sub.id) || excluded.has(sub.official_url)) return null;
  const o = overrides.get(sub.id) || overrides.get(sub.official_url);
  if (!o) return sub;
  const merged = { ...sub, manual: true };
  for (const k of OVERRIDABLE) if (k in o) merged[k] = o[k];
  if ('announce_date' in o && /^\d{4}/.test(o.announce_date || '')) merged.year = +o.announce_date.slice(0, 4);
  return merged.hidden ? null : merged;
}

const LIST_COLUMNS = `id, title, agency, announce_date, year, apply_start, apply_end, apply_end_time, deadline_text,
  until_quota, status_flag, target, target_types, amount_text, summary, official_url, link_status, delegate,
  program_name, first_seen_at, updated_at, views, hidden`;

/** 常態／多年期辦理的重點計畫：今年仍在期程內（或期程未明）就顯示 */
export function ongoingVisible(s, year) {
  if (!s.ongoing) return false;
  return !s.apply_end || s.apply_end >= `${year}-01-01`;
}

/**
 * 去年公告、但今年仍在受理的補助（例：114/12/31 公告、受理至 116/01/31 的住宅家電汰舊換新節能補助）。
 * 判斷依據只用官方期程：截止日在今年以後，或官方寫明額滿為止且未宣告結束。
 */
export function carriedOver(s, year) {
  if (s.year !== year - 1) return false;
  if (s.status_flag) return false;
  if (s.apply_end) return s.apply_end >= `${year}-01-01`;
  return !!s.until_quota;
}

/** 指定年度（預設為台灣時間今年）的公開補助清單：今年公告者 + 去年公告今年仍受理者 */
export async function listSubsidies(db, { year = taipeiYear() } = {}) {
  const [{ results }, ov] = await Promise.all([
    db
      .prepare(
        `SELECT ${LIST_COLUMNS} FROM subsidies WHERE hidden = 0 AND (year BETWEEN ?1 AND ?2
           OR id IN (SELECT target FROM overrides) OR official_url IN (SELECT target FROM overrides))`,
      )
      .bind(year - 1, year + 1)
      .all(),
    loadOverrides(db),
  ]);
  return results
    .map(parseRow)
    .map((s) => applyOverrides(s, ov))
    .filter((s) => s && (s.year === year || carriedOver(s, year) || ongoingVisible(s, year)))
    .map((s) => (s.year === year ? s : s.ongoing ? { ...s, ongoing: true } : { ...s, carried_over: true }));
}

export async function getSubsidy(db, id) {
  const row = await db.prepare('SELECT * FROM subsidies WHERE id = ? AND hidden = 0').bind(id).first();
  if (!row) return null;
  return applyOverrides(parseRow(row), await loadOverrides(db));
}

export async function getMeta(db, keys) {
  const { results } = await db
    .prepare(`SELECT key, value FROM meta WHERE key IN (${keys.map(() => '?').join(',')})`)
    .bind(...keys)
    .all();
  return Object.fromEntries(results.map((r) => [r.key, r.value]));
}
