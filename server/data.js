// 讀取補助資料並套用人工修正／排除。
import { taipeiYear } from '../public/js/logic.js';

const JSON_FIELDS = ['target_types', 'amount_details', 'source_urls', 'attachments', 'signals'];

// 人工修正可覆寫的欄位
export const OVERRIDABLE = [
  'title', 'agency', 'announce_date', 'apply_start', 'apply_end', 'apply_end_time', 'deadline_text',
  'until_quota', 'status_flag', 'target', 'target_types', 'amount_text', 'amount_details', 'summary',
  'content', 'official_url', 'hidden',
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
  until_quota, status_flag, target, target_types, amount_text, summary, official_url, link_status,
  first_seen_at, updated_at, views, hidden`;

/** 指定年度（預設為台灣時間今年）的公開補助清單 */
export async function listSubsidies(db, { year = taipeiYear() } = {}) {
  const [{ results }, ov] = await Promise.all([
    db.prepare(`SELECT ${LIST_COLUMNS} FROM subsidies WHERE hidden = 0 AND year BETWEEN ? AND ?`).bind(year - 1, year + 1).all(),
    loadOverrides(db),
  ]);
  return results
    .map(parseRow)
    .map((s) => applyOverrides(s, ov))
    .filter((s) => s && s.year === year);
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
