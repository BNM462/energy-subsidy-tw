// POST /api/internal/ingest — 爬蟲寫入掃描結果（需 INGEST_TOKEN）。一般訪客無法呼叫。
import { json, error, checkInternalAuth, readJsonBody } from '../../../server/http.js';
import { validateIngest } from '../../../server/ingest-validate.js';

const SUB_COLS = [
  'id', 'dedupe_key', 'title', 'agency', 'announce_date', 'year', 'apply_start', 'apply_end', 'apply_end_time',
  'deadline_text', 'until_quota', 'status_flag', 'target', 'target_types', 'amount_text', 'amount_details', 'summary',
  'content', 'official_url', 'source_urls', 'attachments', 'signals', 'doc_no', 'program_name', 'link_status',
  'content_hash', 'first_seen_at', 'updated_at', 'hidden', 'delegate', 'period_varies',
];
const JSON_COLS = new Set(['target_types', 'amount_details', 'source_urls', 'attachments', 'signals']);

export async function onRequestPost({ request, env }) {
  if (!checkInternalAuth(request, env)) return error(401, 'unauthorized');
  let body;
  try {
    body = validateIngest(await readJsonBody(request, 8 * 1024 * 1024));
  } catch (e) {
    return error(400, `invalid payload: ${e.message}`);
  }
  const db = env.DB;
  const now = new Date().toISOString();
  const stmts = [];

  for (const s of body.sources) {
    stmts.push(
      db
        .prepare(
          `INSERT INTO sources_status (source_id, agency, last_checked_at, last_success_at, last_error, consecutive_failures, discovered_lists, discovered_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, COALESCE(?7, '[]'), ?8)
           ON CONFLICT(source_id) DO UPDATE SET agency = ?2, last_checked_at = ?3,
             last_success_at = COALESCE(?4, last_success_at), last_error = ?5, consecutive_failures = ?6,
             discovered_lists = COALESCE(?7, discovered_lists), discovered_at = COALESCE(?8, discovered_at)`,
        )
        .bind(
          s.source_id, s.agency, s.checked_at, s.ok ? s.checked_at : null, s.error, s.consecutive_failures,
          s.discovered_lists ? JSON.stringify(s.discovered_lists) : null, s.discovered_at,
        ),
    );
  }

  for (const u of body.urls) {
    stmts.push(
      db
        .prepare(
          `INSERT INTO crawl_urls (url, source_id, title, list_date, verdict, reason, subsidy_id, content_hash, first_seen_at, last_checked_at, fail_count)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
           ON CONFLICT(url) DO UPDATE SET source_id = ?2, title = ?3, list_date = ?4, verdict = ?5, reason = ?6,
             subsidy_id = ?7, content_hash = ?8, last_checked_at = ?10, fail_count = ?11`,
        )
        .bind(u.url, u.source_id, u.title, u.list_date, u.verdict, u.reason, u.subsidy_id, u.content_hash, u.first_seen_at, u.last_checked_at, u.fail_count),
    );
  }

  for (const s of body.upserts) {
    const values = SUB_COLS.map((c) => (JSON_COLS.has(c) ? JSON.stringify(s[c] ?? []) : c === 'until_quota' || c === 'hidden' || c === 'period_varies' ? (s[c] ? 1 : 0) : s[c] ?? null));
    const updates = SUB_COLS.filter((c) => c !== 'id' && c !== 'first_seen_at').map((c) => `${c} = excluded.${c}`);
    stmts.push(
      db
        .prepare(
          `INSERT INTO subsidies (${SUB_COLS.join(', ')}) VALUES (${SUB_COLS.map(() => '?').join(', ')})
           ON CONFLICT(id) DO UPDATE SET ${updates.join(', ')}`,
        )
        .bind(...values),
    );
  }

  if (body.overrides) {
    stmts.push(db.prepare('DELETE FROM overrides'));
    for (const o of body.overrides) {
      stmts.push(db.prepare('INSERT OR REPLACE INTO overrides (target, data, note) VALUES (?, ?, ?)').bind(o.target, JSON.stringify(o.set), o.note));
    }
  }
  if (body.exclusions) {
    stmts.push(db.prepare('DELETE FROM exclusions'));
    for (const x of body.exclusions) {
      stmts.push(db.prepare('INSERT OR REPLACE INTO exclusions (target, note) VALUES (?, ?)').bind(x.target, x.note));
    }
  }

  const setMeta = (k, v) => stmts.push(db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').bind(k, v));
  setMeta('last_scan_at', body.scan.finished_at);
  if (body.scan.ok) setMeta('last_successful_scan_at', body.scan.finished_at);
  if (body.data_changed) setMeta('last_data_change_at', body.scan.finished_at);

  stmts.push(
    db
      .prepare('INSERT INTO scan_log (started_at, finished_at, ok, stats, errors) VALUES (?, ?, ?, ?, ?)')
      .bind(body.scan.started_at, body.scan.finished_at, body.scan.ok ? 1 : 0, JSON.stringify(body.scan.stats), JSON.stringify(body.scan.errors)),
  );
  stmts.push(db.prepare('DELETE FROM scan_log WHERE id <= (SELECT MAX(id) - 1000 FROM scan_log)'));

  // 每個 D1 batch 為一個交易；所有寫入皆為 upsert，即使中途失敗，下一輪重送也不會產生重複資料
  for (let i = 0; i < stmts.length; i += 80) await db.batch(stmts.slice(i, i + 80));

  return json({ ok: true, received_at: now, statements: stmts.length });
}
