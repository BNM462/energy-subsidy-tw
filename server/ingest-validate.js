// 爬蟲寫入資料的格式驗證與長度限制（即使持有密鑰，也不接受異常資料）。

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^\d{2}:\d{2}$/;
const ID = /^[a-f0-9]{8,32}$/;
const FLAGS = new Set(['quota_full', 'budget_exhausted', 'closed_early', 'closed']);

function str(v, max, { required = false, name = 'field' } = {}) {
  if (v == null || v === '') {
    if (required) throw new Error(`${name} required`);
    return null;
  }
  if (typeof v !== 'string') throw new Error(`${name} must be string`);
  return v.slice(0, max);
}

function date(v, name) {
  if (v == null || v === '') return null;
  if (typeof v !== 'string' || !DATE.test(v)) throw new Error(`${name} invalid date`);
  return v;
}

function httpUrl(v, name, required = false) {
  const s = str(v, 2000, { required, name });
  if (s == null) return null;
  const u = new URL(s);
  if (!/^https?:$/.test(u.protocol)) throw new Error(`${name} must be http(s)`);
  return u.href;
}

function strArray(v, maxItems, maxLen) {
  if (!Array.isArray(v)) return [];
  return v.filter((x) => typeof x === 'string').slice(0, maxItems).map((x) => x.slice(0, maxLen));
}

function int(v, def = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : def;
}

function arr(v, max, name) {
  if (v == null) return [];
  if (!Array.isArray(v)) throw new Error(`${name} must be array`);
  if (v.length > max) throw new Error(`${name} too many`);
  return v;
}

export function validateSubsidy(s) {
  if (!s || typeof s !== 'object') throw new Error('subsidy must be object');
  if (!ID.test(s.id || '')) throw new Error('subsidy id invalid');
  const flag = s.status_flag && FLAGS.has(s.status_flag) ? s.status_flag : null;
  const year = s.year == null ? null : int(s.year);
  if (year != null && (year < 2000 || year > 2100)) throw new Error('year invalid');
  return {
    id: s.id,
    dedupe_key: str(s.dedupe_key, 300, { required: true, name: 'dedupe_key' }),
    title: str(s.title, 300, { required: true, name: 'title' }),
    agency: str(s.agency, 100, { required: true, name: 'agency' }),
    announce_date: date(s.announce_date, 'announce_date'),
    year,
    apply_start: date(s.apply_start, 'apply_start'),
    apply_end: date(s.apply_end, 'apply_end'),
    apply_end_time: s.apply_end_time && TIME.test(s.apply_end_time) ? s.apply_end_time : null,
    deadline_text: str(s.deadline_text, 300),
    until_quota: !!s.until_quota,
    status_flag: flag,
    target: str(s.target, 500),
    target_types: strArray(s.target_types, 12, 30),
    amount_text: str(s.amount_text, 200),
    amount_details: strArray(s.amount_details, 10, 200),
    summary: str(s.summary, 600),
    content: str(s.content, 8000),
    official_url: httpUrl(s.official_url, 'official_url', true),
    source_urls: strArray(s.source_urls, 20, 2000),
    attachments: Array.isArray(s.attachments)
      ? s.attachments.slice(0, 15).map((a) => ({ url: httpUrl(a.url, 'attachment'), label: str(a.label, 120) || '附件' }))
      : [],
    signals: strArray(s.signals, 30, 30),
    doc_no: str(s.doc_no, 60),
    program_name: str(s.program_name, 120),
    link_status: s.link_status === 'dead' ? 'dead' : 'ok',
    content_hash: str(s.content_hash, 64),
    first_seen_at: str(s.first_seen_at, 40, { required: true, name: 'first_seen_at' }),
    updated_at: str(s.updated_at, 40, { required: true, name: 'updated_at' }),
    hidden: !!s.hidden,
    delegate: str(s.delegate, 120),
  };
}

export function validateIngest(b) {
  if (!b || typeof b !== 'object') throw new Error('body must be object');
  const scan = b.scan || {};
  const out = {
    scan: {
      started_at: str(scan.started_at, 40, { required: true, name: 'started_at' }),
      finished_at: str(scan.finished_at, 40, { required: true, name: 'finished_at' }),
      ok: !!scan.ok,
      stats: typeof scan.stats === 'object' && scan.stats ? scan.stats : {},
      errors: strArray(scan.errors, 100, 300),
    },
    sources: arr(b.sources, 300, 'sources').map((s) => ({
      source_id: str(s.source_id, 60, { required: true, name: 'source_id' }),
      agency: str(s.agency, 100),
      checked_at: str(s.checked_at, 40),
      ok: !!s.ok,
      error: str(s.error, 300),
      consecutive_failures: int(s.consecutive_failures),
      discovered_lists: s.discovered_lists ? strArray(s.discovered_lists, 30, 2000) : null,
      discovered_at: str(s.discovered_at, 40),
    })),
    urls: arr(b.urls, 3000, 'urls').map((u) => ({
      url: httpUrl(u.url, 'url', true),
      source_id: str(u.source_id, 60),
      title: str(u.title, 300),
      list_date: date(u.list_date, 'list_date'),
      verdict: ['subsidy', 'not', 'error'].includes(u.verdict) ? u.verdict : 'error',
      reason: str(u.reason, 200),
      subsidy_id: u.subsidy_id && ID.test(u.subsidy_id) ? u.subsidy_id : null,
      content_hash: str(u.content_hash, 64),
      first_seen_at: str(u.first_seen_at, 40, { required: true, name: 'first_seen_at' }),
      last_checked_at: str(u.last_checked_at, 40),
      fail_count: int(u.fail_count),
    })),
    upserts: arr(b.upserts, 1000, 'upserts').map(validateSubsidy),
    overrides: b.overrides == null ? null : arr(b.overrides, 500, 'overrides').map((o) => ({
      target: str(o.target, 2000, { required: true, name: 'override target' }),
      set: typeof o.set === 'object' && o.set ? o.set : {},
      note: str(o.note, 300),
    })),
    exclusions: b.exclusions == null ? null : arr(b.exclusions, 2000, 'exclusions').map((x) => ({
      target: str(x.target, 2000, { required: true, name: 'exclusion target' }),
      note: str(x.note, 300),
    })),
    data_changed: !!b.data_changed,
  };
  return out;
}
