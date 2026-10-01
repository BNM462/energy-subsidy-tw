// GET /api/internal/state — 爬蟲取得目前狀態（需 INGEST_TOKEN）
import { json, error, checkInternalAuth } from '../../../server/http.js';
import { taipeiYear } from '../../../public/js/logic.js';

export async function onRequestGet({ request, env }) {
  if (!checkInternalAuth(request, env)) return error(401, 'unauthorized');
  const db = env.DB;
  const [subs, urls, sources, meta] = await db.batch([
    db
      .prepare(
        `SELECT id, dedupe_key, title, agency, year, announce_date, apply_start, apply_end, official_url, source_urls,
                content_hash, link_status, program_name, doc_no, first_seen_at
         FROM subsidies WHERE year >= ? OR year IS NULL`,
      )
      .bind(taipeiYear() - 1),
    db.prepare('SELECT url, source_id, verdict, subsidy_id, content_hash, first_seen_at, last_checked_at, fail_count FROM crawl_urls'),
    db.prepare('SELECT * FROM sources_status'),
    db.prepare('SELECT key, value FROM meta'),
  ]);
  return json({
    subsidies: subs.results.map((s) => ({ ...s, source_urls: JSON.parse(s.source_urls || '[]') })),
    crawl_urls: urls.results,
    sources: sources.results.map((s) => ({ ...s, discovered_lists: JSON.parse(s.discovered_lists || '[]') })),
    meta: Object.fromEntries(meta.results.map((r) => [r.key, r.value])),
  });
}
