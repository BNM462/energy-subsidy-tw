// 中央政府節能補助爬蟲（GitHub Actions 每 30 分鐘執行）
//
//   node crawler/run.mjs              掃描並寫入網站資料庫（需環境變數 API_BASE、INGEST_TOKEN）
//   node crawler/run.mjs --dry-run    只掃描，結果寫到 crawler/out/，不寫入資料庫
//
// 原則：官方網站暫時無法連線時不刪除既有資料、不猜測內容，記錄錯誤下次重試。
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fetchPage, fetchResource, mapLimit } from './lib/fetcher.mjs';
import { discoverListPages, SUBSIDY_ZONE_TEXT, sameAgency } from './lib/discover.mjs';
import { extractListLinks, extractMain, findNextPage, extractRowDocs } from './lib/html.mjs';
import { classify, titleWorthFetching } from './lib/classify.mjs';
import { extractFields } from './lib/extract.mjs';
import { documentText, filenameFromDisposition } from './lib/docs.mjs';
import { dedupeKey, idFromKey, findMatch, sha1 } from './lib/dedupe.mjs';
import { normalizeText, toAdYear } from './lib/dates.mjs';
import { taipeiYear } from '../public/js/logic.js';

// 擷取規則有改時調高版本，下次掃描會重新整理所有已知頁面
const EXTRACTOR_VERSION = '4';

const HOUR = 3600e3;
const RECHECK_SUBSIDY_MS = 6 * HOUR;
const RETRY_ERROR_MS = 2 * HOUR;
const DISCOVERY_MS = 24 * HOUR;
const MAX_DETAIL_PER_RUN = 150;
const MAX_BACKFILL_PAGES = 6;
const DEAD_AFTER_FAILS = 3;
const TIME_BUDGET_MS = 17 * 60e3;

const args = new Set(process.argv.slice(2));
const DRY = args.has('--dry-run');
// --only=id1,id2：只掃描指定來源（測試用）
const ONLY = (process.argv.find((a) => a.startsWith('--only=')) || '').slice(7).split(',').filter(Boolean);
const FORCE_DISCOVERY = args.has('--rediscover') || process.env.FORCE_DISCOVERY === '1';
const API_BASE = (process.env.API_BASE || '').replace(/\/$/, '');
const TOKEN = process.env.INGEST_TOKEN || '';
const OUT_DIR = new URL('./out/', import.meta.url);

const startedMs = Date.now();
const startedAt = new Date(startedMs).toISOString();
const nowIso = () => new Date().toISOString();
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const readJson = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url), 'utf8'));

const { sources } = readJson('./config/sources.json');
const overridesCfg = readJson('./config/manual_overrides.json').overrides || [];
const exclusionsCfg = readJson('./config/exclusions.json').exclusions || [];
const excludedTargets = new Set(exclusionsCfg.map((x) => x.target));

// ---------- 狀態 ----------
async function api(path, init = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json', ...(init.headers || {}) },
  });
  if (!res.ok) throw new Error(`API ${path} HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

async function loadState() {
  if (DRY) {
    const p = new URL('state.json', OUT_DIR);
    return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : { subsidies: [], crawl_urls: [], sources: [], meta: {} };
  }
  if (!API_BASE || TOKEN.length < 32) throw new Error('缺少 API_BASE 或 INGEST_TOKEN 環境變數');
  return api('/api/internal/state');
}

// ---------- 工具 ----------
const isFileUrl = (u) => /\.(pdf|odt|docx?)(\?|$)/i.test(u);
const isGovUrl = (u) => {
  try {
    return /\.gov\.tw$/i.test(new URL(u).hostname);
  } catch {
    return false;
  }
};

function pickTitle(listTitle, main) {
  const t = (listTitle || '').trim();
  const truncated = /(\.\.\.|…)$/.test(t);
  if (truncated || t.length < 8) {
    const prefix = t.replace(/(\.\.\.|…)$/, '').slice(0, 12);
    const line = main.text.split('\n').find((l) => prefix && l.startsWith(prefix) && l.length > t.length);
    if (line) return line.slice(0, 200);
    if (main.heading && main.heading.length > t.length) return main.heading;
  }
  return t || main.heading || main.pageTitle;
}

async function attachmentsText(attachments) {
  let text = '';
  for (const a of attachments.slice(0, 3)) {
    try {
      const r = await fetchResource(a.url, { binary: true });
      const name = filenameFromDisposition(r.disposition) || a.label;
      text += (await documentText(r.bytes, { contentType: r.contentType, name })) + '\n';
    } catch {
      /* 附件讀取失敗不影響主要內容 */
    }
  }
  return text;
}

async function loadDetail(url, row) {
  if (row) return { url, main: { text: row.text, heading: row.title, pageTitle: '', attachments: [] } };
  if (isFileUrl(url)) {
    const r = await fetchResource(url, { binary: true });
    const text = await documentText(r.bytes, { contentType: r.contentType, name: filenameFromDisposition(r.disposition) || url });
    return { url: r.url, main: { text, heading: '', pageTitle: '', attachments: [] } };
  }
  const page = await fetchPage(url);
  return { url: page.url, main: extractMain(page.text, page.url) };
}

// ---------- 主流程 ----------
async function main() {
  const state = await loadState();
  const now = Date.now();
  const year = taipeiYear(now);
  // 含去年全年：去年公告、今年仍受理的補助也要收錄
  const minDate = `${year - 1}-01-01`;
  const errors = [];

  const urlState = new Map(state.crawl_urls.map((u) => [u.url, u]));
  const sourceState = new Map(state.sources.map((s) => [s.source_id, s]));
  const subsidies = new Map(state.subsidies.map((s) => [s.id, s]));

  // 1) 來源探索 + 列表掃描
  const candidates = new Map(); // url -> { url, title, date, source }
  const sourceResults = [];
  await mapLimit(sources.filter((s) => s.enabled !== false && (!ONLY.length || ONLY.includes(s.id))), 6, async (src) => {
    const prev = sourceState.get(src.id);
    const res = { source_id: src.id, agency: src.agency, checked_at: nowIso(), ok: false, error: null, consecutive_failures: 0 };
    let lists = [...(src.lists || [])];
    let anyOk = false;
    const errs = [];
    // 每日重新探索列表頁
    // skip_discovery：只看設定好的列表（例如受託執行單位網站，不從首頁自動擴充）
    const needDiscovery = !src.skip_discovery && (FORCE_DISCOVERY || !prev?.discovered_at || now - Date.parse(prev.discovered_at) > DISCOVERY_MS || !(prev.discovered_lists || []).length);
    if (needDiscovery) {
      try {
        const home = await fetchPage(src.homepage);
        anyOk = true;
        const level1 = discoverListPages(home.text, home.url, { max: 8 });
        const found = new Set(level1.map((l) => l.url));
        for (const l of level1.filter((x) => SUBSIDY_ZONE_TEXT.test(x.text)).slice(0, 3)) {
          try {
            const p = await fetchPage(l.url);
            for (const l2 of discoverListPages(p.text, p.url, { max: 6 })) if (l2.score >= 3) found.add(l2.url);
          } catch {
            /* 第二層失敗不影響 */
          }
        }
        res.discovered_lists = [...found].slice(0, 14);
        res.discovered_at = nowIso();
      } catch (e) {
        errs.push(`首頁：${e.message}`);
        res.discovered_lists = null;
      }
    }
    const discovered = res.discovered_lists || prev?.discovered_lists || [];
    lists = [...new Set([...lists, ...discovered])];

    for (const listUrl of lists) {
      try {
        let page = await fetchPage(listUrl);
        anyOk = true;
        // 平常只看第 1 頁；每日探索時往後翻頁，補齊今年較早的公告（含已截止）
        const maxPages = needDiscovery ? MAX_BACKFILL_PAGES : 1;
        for (let p = 1; p <= maxPages; p++) {
          const links = extractListLinks(page.text, page.url);
          for (const l of links) {
            if (!(sameAgency(l.url, src.homepage) || isGovUrl(l.url))) continue;
            if (excludedTargets.has(l.url)) continue;
            if (!titleWorthFetching(l.title)) continue;
            if (l.date && l.date < minDate) continue;
            if (!candidates.has(l.url)) candidates.set(l.url, { ...l, source: src });
          }
          const dated = links.filter((l) => l.date);
          const reachedOld = dated.length && dated.every((l) => l.date < minDate);
          const next = p < maxPages && !reachedOld && findNextPage(page.text, page.url);
          if (!next) break;
          page = await fetchPage(next);
        }
      } catch (e) {
        errs.push(`${listUrl.slice(0, 80)}：${e.message}`);
      }
    }
    // 表格列模式：每一列視為一則公告（該列沒有獨立網頁）
    for (const listUrl of src.row_lists || []) {
      try {
        const page = await fetchPage(listUrl);
        anyOk = true;
        for (const r of extractRowDocs(page.text, page.url)) {
          if (excludedTargets.has(r.url)) continue;
          if (!titleWorthFetching(r.title)) continue;
          if (r.date < minDate) continue;
          if (!candidates.has(r.url)) candidates.set(r.url, { url: r.url, title: r.title, date: r.date, source: src, row: r });
        }
      } catch (e) {
        errs.push(`${listUrl.slice(0, 80)}：${e.message}`);
      }
    }
    res.ok = anyOk;
    res.error = errs.length ? errs.slice(0, 3).join('；').slice(0, 300) : null;
    res.consecutive_failures = anyOk ? 0 : (prev?.consecutive_failures || 0) + 1;
    if (!anyOk) errors.push(`${src.agency}：${res.error}`);
    sourceResults.push(res);
    log(`${anyOk ? '✔' : '✖'} ${src.agency}（列表 ${lists.length}）${res.error ? ' ⚠ ' + res.error.slice(0, 80) : ''}`);
  });

  // 已知補助的官方網址也定期複查（狀態變更、網址失效）
  for (const s of subsidies.values()) {
    if (s.year < year - 1 || !s.official_url || candidates.has(s.official_url)) continue;
    if (s.official_url.includes('#row-')) continue; // 表格列資料由列表頁本身更新
    const src = sources.find((x) => x.agency === s.agency) || { id: 'known', agency: s.agency, homepage: s.official_url };
    candidates.set(s.official_url, { url: s.official_url, title: s.title, date: s.announce_date, source: src, known: true });
  }

  // 2) 決定要抓哪些內文頁
  const todo = [];
  for (const c of candidates.values()) {
    const st = urlState.get(c.url);
    const age = st?.last_checked_at ? now - Date.parse(st.last_checked_at) : Infinity;
    let priority = null;
    if (!st) priority = 0;
    else if (st.verdict === 'error' && age > RETRY_ERROR_MS && st.fail_count < 12) priority = 1;
    else if (st.verdict === 'subsidy' && (FORCE_DISCOVERY || age > RECHECK_SUBSIDY_MS)) priority = 2;
    else if (c.row && st.content_hash !== sha1(EXTRACTOR_VERSION + c.row.text)) priority = 2;
    if (priority != null) todo.push({ ...c, priority });
  }
  todo.sort((a, b) => a.priority - b.priority || (b.date || '').localeCompare(a.date || ''));
  const batch = todo.slice(0, MAX_DETAIL_PER_RUN);
  log(`候選 ${candidates.size} 筆，本輪檢查內文 ${batch.length} 筆`);

  // 3) 抓內文、判斷、擷取
  const urlUpdates = [];
  const docs = [];
  const deadUrls = new Set();
  const aliveUrls = new Set();
  const withdrawnUrls = new Set();
  await mapLimit(batch, 6, async (c) => {
    if (Date.now() - startedMs > TIME_BUDGET_MS) return;
    const st = urlState.get(c.url);
    const rec = {
      url: c.url, source_id: c.source.id, title: c.title?.slice(0, 300) || null, list_date: c.date || null,
      verdict: st?.verdict || 'error', reason: st?.reason || null, subsidy_id: st?.subsidy_id || null,
      content_hash: st?.content_hash || null, first_seen_at: st?.first_seen_at || nowIso(), last_checked_at: nowIso(),
      fail_count: st?.fail_count || 0,
    };
    urlUpdates.push(rec);
    let detail;
    try {
      detail = await loadDetail(c.url, c.row);
    } catch (e) {
      rec.fail_count += 1;
      rec.reason = e.message.slice(0, 200);
      if (!st || st.verdict === 'error') rec.verdict = 'error';
      if (e.permanent && rec.fail_count >= DEAD_AFTER_FAILS) deadUrls.add(c.url);
      return;
    }
    rec.fail_count = 0;
    aliveUrls.add(c.url);
    const { main } = detail;
    const hash = sha1(EXTRACTOR_VERSION + main.text);
    if (st && st.content_hash === hash && st.verdict !== 'error') return; // 內容沒變
    rec.content_hash = hash;

    const title = pickTitle(c.title, main);
    let cls = classify({ title, text: main.text });
    let attText = '';
    // 內文很短（詳見附件）時，讀附件再判斷一次
    if (!cls.isSubsidy && titleWorthFetching(title) && main.text.replace(/\s/g, '').length < 600 && main.attachments.length) {
      attText = await attachmentsText(main.attachments);
      cls = classify({ title, text: `${main.text}\n${attText}` });
    }
    rec.title = title.slice(0, 300);
    if (!cls.isSubsidy) {
      // 先前判為補助、重新判定後不符合 → 自動撤下（資料保留在資料庫，只是不公開）
      if (st?.verdict === 'subsidy') withdrawnUrls.add(c.url);
      rec.verdict = 'not';
      rec.reason = cls.reason;
      return;
    }
    if (!attText && main.attachments.length) attText = await attachmentsText(main.attachments);
    const f = extractFields({ title, text: main.text, listDate: c.date, attachmentText: attText });
    // 公告年度：公告日期 → 列表日期 → 標題明寫的年度（如「115年度」）；都沒有就是未知（不顯示在當年度清單，但保留資料）
    const ty = /(?<!\d)(\d{2,3})\s*年度/.exec(normalizeText(title));
    const docYear = f.announce_date ? +f.announce_date.slice(0, 4) : c.date ? +c.date.slice(0, 4) : ty ? toAdYear(ty[1]) : null;
    rec.verdict = 'subsidy';
    rec.reason = cls.signals.join('、').slice(0, 200);
    docs.push({
      rec,
      doc: {
        title,
        agency: c.source.agency,
        year: docYear,
        ...f,
        delegate: c.source.delegate || f.delegate,
        official_url: c.url,
        source_urls: [c.url],
        attachments: main.attachments.slice(0, 10),
        signals: cls.signals,
        content: main.text.slice(0, 8000),
        content_hash: hash,
      },
    });
  });

  // 4) 去重、合併成補助資料
  const DISPLAY_FIELDS = [
    'title', 'agency', 'announce_date', 'year', 'apply_start', 'apply_end', 'apply_end_time', 'deadline_text', 'until_quota',
    'status_flag', 'target', 'amount_text', 'summary', 'official_url', 'link_status',
  ];
  const displayHash = (s) => sha1(JSON.stringify(DISPLAY_FIELDS.map((k) => s?.[k] ?? null)));
  const upserts = new Map();
  let dataChanged = false;

  // 有公告年度的先處理；沒有日期的計畫介紹頁（如「補助作業」說明頁）再併入對應的公告
  // 同一計畫有多個年度時，由最新年度的公告接手原本的計畫介紹頁
  docs.sort((a, b) => (a.doc.year == null) - (b.doc.year == null) || (b.doc.year || 0) - (a.doc.year || 0));
  for (const { rec, doc } of docs) {
    const existingList = [...subsidies.values()];
    const match = findMatch(doc, existingList);
    let merged;
    if (match && match.year == null && doc.year != null) {
      // 先前只有計畫介紹頁，現在找到正式公告 → 以公告為主，介紹頁保留為參考來源
      merged = {
        ...match,
        ...doc,
        id: match.id,
        first_seen_at: match.first_seen_at,
        target: doc.target ?? match.target,
        amount_text: doc.amount_text ?? match.amount_text,
        amount_details: doc.amount_text ? doc.amount_details : match.amount_details,
        source_urls: [...new Set([doc.official_url, match.official_url, ...(match.source_urls || [])])].slice(0, 20),
      };
    } else if (match) {
      const sameOfficial = match.official_url === doc.official_url;
      merged = { ...match };
      for (const k of ['announce_date', 'apply_start', 'apply_end', 'apply_end_time', 'deadline_text', 'target', 'amount_text', 'summary', 'program_name', 'doc_no', 'delegate']) {
        // 官方原頁更新 → 以新內容為準；其他來源 → 只補空欄位
        if (doc[k] != null && (sameOfficial || merged[k] == null)) merged[k] = doc[k];
      }
      if (sameOfficial) {
        merged.title = doc.title;
        merged.content = doc.content;
        merged.attachments = doc.attachments;
        merged.amount_details = doc.amount_details;
        merged.target_types = doc.target_types;
        merged.signals = doc.signals;
        merged.content_hash = doc.content_hash;
      } else {
        merged.target_types = [...new Set([...(merged.target_types || []), ...doc.target_types])];
        if (!merged.content) merged.content = doc.content;
      }
      // 金額由其他來源補上時，一併帶入金額細節
      if (!sameOfficial && merged.amount_text === doc.amount_text && !(merged.amount_details || []).length) merged.amount_details = doc.amount_details;
      merged.until_quota = !!(merged.until_quota || doc.until_quota);
      // 官方宣告額滿／用罄／提前截止：一旦出現就採用
      if (doc.status_flag) merged.status_flag = doc.status_flag;
      merged.source_urls = [...new Set([...(merged.source_urls || []), doc.official_url])].slice(0, 20);
      if (merged.announce_date) merged.year = +merged.announce_date.slice(0, 4);
    } else {
      merged = { ...doc, first_seen_at: rec.first_seen_at, link_status: 'ok' };
    }
    merged.dedupe_key = match && match.year != null ? match.dedupe_key : dedupeKey(merged);
    merged.id = match?.id || idFromKey(merged.dedupe_key);
    // 不同補助剛好算出相同 id 時，避免覆蓋
    if (!match && subsidies.has(merged.id)) merged.id = idFromKey(merged.dedupe_key + '|' + doc.official_url);
    rec.subsidy_id = merged.id;
    if (!match || displayHash(match) !== displayHash(merged)) {
      dataChanged = true;
      merged.updated_at = nowIso();
    } else {
      merged.updated_at = match.updated_at || nowIso();
    }
    merged.first_seen_at ||= rec.first_seen_at;
    merged.hidden = 0;
    subsidies.set(merged.id, merged);
    upserts.set(merged.id, merged);
  }

  // 重新判定為非節能補助 → 撤下
  for (const s of subsidies.values()) {
    if (!s.hidden && withdrawnUrls.has(s.official_url)) {
      const u = { ...s, hidden: 1, updated_at: nowIso() };
      subsidies.set(s.id, u);
      upserts.set(s.id, u);
      dataChanged = true;
    }
  }

  // 官方網址失效／恢復
  for (const s of subsidies.values()) {
    let status = s.link_status;
    if (deadUrls.has(s.official_url)) status = 'dead';
    else if (aliveUrls.has(s.official_url)) status = 'ok';
    if (status !== s.link_status) {
      const u = { ...s, link_status: status, updated_at: nowIso() };
      subsidies.set(s.id, u);
      upserts.set(s.id, u);
      dataChanged = true;
    }
  }

  const finishedAt = nowIso();
  const stats = {
    sources: sourceResults.length,
    sources_ok: sourceResults.filter((s) => s.ok).length,
    candidates: candidates.size,
    checked: urlUpdates.length,
    subsidy_docs: docs.length,
    upserts: upserts.size,
    total_subsidies: subsidies.size,
    seconds: Math.round((Date.now() - startedMs) / 1000),
  };
  const payload = {
    scan: { started_at: startedAt, finished_at: finishedAt, ok: stats.sources_ok > 0, stats, errors: errors.slice(0, 100) },
    sources: sourceResults,
    urls: urlUpdates,
    upserts: [...upserts.values()],
    overrides: overridesCfg.filter((o) => o && o.target && o.set).map((o) => ({ target: o.target, set: o.set, note: o.note || null })),
    exclusions: exclusionsCfg.filter((x) => x && x.target).map((x) => ({ target: x.target, note: x.note || null })),
    data_changed: dataChanged,
  };

  mkdirSync(OUT_DIR, { recursive: true });
  const failing = sourceResults.filter((s) => s.consecutive_failures >= 6);
  writeFileSync(
    new URL('last-run.json', OUT_DIR),
    JSON.stringify({ stats, data_changed: dataChanged, failing_sources: failing.map((s) => ({ agency: s.agency, error: s.error, consecutive_failures: s.consecutive_failures })), errors }, null, 2),
  );

  if (DRY) {
    // 模擬資料庫狀態，方便連續測試
    const merged = {
      subsidies: [...subsidies.values()],
      crawl_urls: [...new Map([...state.crawl_urls, ...urlUpdates].map((u) => [u.url, u])).values()],
      sources: sourceResults.map((s) => ({ ...sourceState.get(s.source_id), ...s, discovered_lists: s.discovered_lists || sourceState.get(s.source_id)?.discovered_lists || [] })),
      meta: state.meta,
    };
    writeFileSync(new URL('state.json', OUT_DIR), JSON.stringify(merged, null, 2));
    writeFileSync(new URL('payload.json', OUT_DIR), JSON.stringify(payload, null, 2));
    log('（dry-run）結果已寫入 crawler/out/');
  } else {
    const r = await api('/api/internal/ingest', { method: 'POST', body: JSON.stringify(payload) });
    log(`已寫入資料庫：${r.statements} 項操作`);
  }
  log('完成', JSON.stringify(stats));
  if (failing.length) log(`⚠ 連續失敗的來源：${failing.map((s) => s.agency).join('、')}`);
}

main().catch((e) => {
  console.error('爬蟲執行失敗：', e.message);
  try {
    mkdirSync(OUT_DIR, { recursive: true });
    writeFileSync(new URL('last-run.json', OUT_DIR), JSON.stringify({ fatal: e.message }, null, 2));
  } catch {
    /* ignore */
  }
  process.exit(1);
});
