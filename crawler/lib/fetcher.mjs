// 禮貌爬取：同一主機一次只送一個請求、請求間隔、逾時、大小上限、robots.txt。
import tls from 'node:tls';
import http from 'node:http';
import https from 'node:https';
import zlib from 'node:zlib';
import { readdirSync, readFileSync } from 'node:fs';

// 部分政府網站伺服器未送出完整憑證鏈（缺 TWCA 中繼憑證），瀏覽器會自動補抓，Node 不會。
// 這裡加入 crawler/certs 內由 TWCA 官方 AIA 網址下載的中繼憑證，仍維持完整憑證驗證。
(function loadExtraCAs() {
  if (typeof tls.setDefaultCACertificates !== 'function') return;
  const dir = new URL('../certs/', import.meta.url);
  try {
    const extra = readdirSync(dir).filter((f) => f.endsWith('.pem')).map((f) => readFileSync(new URL(f, dir), 'utf8'));
    if (extra.length) tls.setDefaultCACertificates([...tls.getCACertificates('default'), ...extra]);
  } catch {
    /* 沒有額外憑證也可運作 */
  }
})();

export const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; compatible; EnergySubsidyTW/1.0; +https://github.com/BNM462/energy-subsidy-tw)';

const HOST_DELAY_MS = 1500;
const TIMEOUT_MS = 25000;
const MAX_HTML_BYTES = 5 * 1024 * 1024;
const MAX_FILE_BYTES = 15 * 1024 * 1024;

const hostQueue = new Map(); // host -> Promise (上一個請求完成時間)
const robotsCache = new Map(); // host -> { disallow: string[] } | null

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function hostOf(url) {
  return new URL(url).host;
}

/** 同一主機序列化並間隔請求 */
async function throttled(host, fn) {
  const prev = hostQueue.get(host) || Promise.resolve();
  let release;
  const gate = new Promise((r) => (release = r));
  hostQueue.set(host, prev.then(() => gate));
  await prev;
  try {
    return await fn();
  } finally {
    setTimeout(release, HOST_DELAY_MS);
  }
}

// 簡易 cookie（部分 ASP.NET 網站轉址時需要 session cookie）
const cookieJar = new Map(); // host -> Map(name -> value)

function storeCookies(host, setCookie) {
  if (!setCookie) return;
  const jar = cookieJar.get(host) || new Map();
  for (const c of [].concat(setCookie)) {
    const [pair] = c.split(';');
    const i = pair.indexOf('=');
    if (i > 0) jar.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
  }
  cookieJar.set(host, jar);
}

function cookieHeader(host) {
  const jar = cookieJar.get(host);
  return jar && jar.size ? [...jar].map(([k, v]) => `${k}=${v}`).join('; ') : null;
}

/** 單次請求（不跟隨轉址），讀取上限 limit bytes */
function requestOnce(url, { accept, timeout, limit }) {
  const u = new URL(url);
  const mod = u.protocol === 'https:' ? https : http;
  const headers = {
    'user-agent': USER_AGENT,
    accept: accept || 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'accept-language': 'zh-TW,zh;q=0.9',
    'accept-encoding': 'gzip, deflate, br',
  };
  const ck = cookieHeader(u.host);
  if (ck) headers.cookie = ck;
  return new Promise((resolve, reject) => {
    const req = mod.get(u, { headers, timeout }, (res) => {
      storeCookies(u.host, res.headers['set-cookie']);
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return resolve({ status: res.statusCode, headers: res.headers, location: new URL(res.headers.location, u).href });
      }
      const len = Number(res.headers['content-length'] || 0);
      if (len && len > limit) {
        res.destroy();
        return reject(new FetchError(`檔案過大 (${len} bytes)`, { status: res.statusCode }));
      }
      const enc = (res.headers['content-encoding'] || '').toLowerCase();
      const stream =
        enc === 'gzip' ? res.pipe(zlib.createGunzip()) :
        enc === 'deflate' ? res.pipe(zlib.createInflate()) :
        enc === 'br' ? res.pipe(zlib.createBrotliDecompress()) : res;
      const chunks = [];
      let total = 0;
      stream.on('data', (c) => {
        total += c.length;
        if (total > limit) {
          res.destroy();
          stream.destroy();
          reject(new FetchError(`檔案過大 (> ${limit} bytes)`, { status: res.statusCode }));
          return;
        }
        chunks.push(c);
      });
      stream.on('end', () => resolve({ status: res.statusCode, headers: res.headers, bytes: new Uint8Array(Buffer.concat(chunks)) }));
      stream.on('error', (e) => reject(new FetchError(`解壓縮失敗：${e.message}`, { status: res.statusCode })));
    });
    req.on('timeout', () => req.destroy(new FetchError('連線逾時')));
    req.on('error', (e) => reject(e instanceof FetchError ? e : new FetchError(e.code || e.message)));
  });
}

async function rawFetch(url, { accept, timeout = TIMEOUT_MS, limit = MAX_HTML_BYTES } = {}) {
  let current = url;
  for (let hop = 0; hop < 6; hop++) {
    const r = await requestOnce(current, { accept, timeout, limit });
    if (r.location) {
      current = r.location;
      continue;
    }
    return { ...r, url: current };
  }
  throw new FetchError('轉址次數過多');
}

export class FetchError extends Error {
  constructor(message, { status = 0, permanent = false } = {}) {
    super(message);
    this.status = status;
    // permanent: 404/410 等明確表示頁面已不存在
    this.permanent = permanent;
  }
}

function detectCharset(contentType, bytes) {
  const m = /charset=([\w-]+)/i.exec(contentType || '');
  if (m) return m[1].toLowerCase();
  const head = new TextDecoder('latin1').decode(bytes.slice(0, 4096));
  const mm = /<meta[^>]+charset=["']?([\w-]+)/i.exec(head);
  return mm ? mm[1].toLowerCase() : 'utf-8';
}

function decode(bytes, charset) {
  // UTF-8 BOM 優先（有些網站標示 Big5 但實際為 UTF-8）
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return new TextDecoder('utf-8').decode(bytes);
  const label = /big5|ms950|cp950/i.test(charset) ? 'big5' : charset;
  try {
    return new TextDecoder(label).decode(bytes);
  } catch {
    return new TextDecoder('utf-8').decode(bytes);
  }
}

function loadRobots(origin) {
  const host = new URL(origin).host;
  if (!robotsCache.has(host)) {
    robotsCache.set(
      host,
      (async () => {
        try {
          const res = await throttled(host, () =>
            rawFetch(`${origin}/robots.txt`, { accept: 'text/plain', timeout: 10000, limit: 256 * 1024 }),
          );
          if (res.status === 200 && /text\/plain/i.test(res.headers['content-type'] || '')) {
            return parseRobots(new TextDecoder().decode(res.bytes));
          }
        } catch {
          /* 讀不到 robots.txt 視為無限制 */
        }
        return null;
      })(),
    );
  }
  return robotsCache.get(host);
}

/** 解析 robots.txt，只取適用於 * 的群組（含 Allow／Disallow） */
export function parseRobots(text) {
  const rules = [];
  let applies = false;
  let sawRuleForGroup = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim();
    const m = /^([\w-]+)\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const val = m[2].trim();
    if (key === 'user-agent') {
      if (sawRuleForGroup) {
        applies = false;
        sawRuleForGroup = false;
      }
      if (val === '*' || /energysubsidytw/i.test(val)) applies = true;
    } else if (key === 'allow' || key === 'disallow') {
      sawRuleForGroup = true;
      if (applies && val) rules.push({ allow: key === 'allow', path: val });
    } else {
      sawRuleForGroup = true;
    }
  }
  return { rules };
}

function robotsPatternMatch(pattern, path) {
  const anchored = pattern.endsWith('$');
  const body = anchored ? pattern.slice(0, -1) : pattern;
  const re = new RegExp('^' + body.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + (anchored ? '$' : ''));
  return re.test(path);
}

/** Google 規則：最長符合者優先，長度相同時 Allow 優先 */
export function robotsAllows(parsed, url) {
  if (!parsed) return true;
  const u = new URL(url);
  const path = u.pathname + u.search;
  let best = null;
  for (const r of parsed.rules) {
    if (!robotsPatternMatch(r.path, path)) continue;
    if (!best || r.path.length > best.path.length || (r.path.length === best.path.length && r.allow)) best = r;
  }
  return !best || best.allow;
}

/**
 * 取得頁面或檔案。回傳 { url, status, contentType, text?, bytes? }
 * 失敗時丟出 FetchError；暫時性錯誤會重試一次。
 */
export async function fetchResource(url, { binary = false, respectRobots = true } = {}) {
  const u = new URL(url);
  if (!/^https?:$/.test(u.protocol)) throw new FetchError('不支援的網址', { permanent: true });
  if (respectRobots) {
    const rules = await loadRobots(u.origin);
    if (!robotsAllows(rules, url)) throw new FetchError('robots.txt 不允許', { permanent: false });
  }
  let lastErr;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await throttled(hostOf(url), async () => {
        const res = await rawFetch(url, binary ? { accept: '*/*', limit: MAX_FILE_BYTES } : {});
        if (res.status === 404 || res.status === 410) {
          throw new FetchError(`HTTP ${res.status}`, { status: res.status, permanent: true });
        }
        if (res.status < 200 || res.status >= 300) throw new FetchError(`HTTP ${res.status}`, { status: res.status });
        const contentType = res.headers['content-type'] || '';
        const out = { url: res.url, status: res.status, contentType, disposition: res.headers['content-disposition'] || '' };
        if (binary) out.bytes = res.bytes;
        else out.text = decode(res.bytes, detectCharset(contentType, res.bytes));
        return out;
      });
    } catch (e) {
      lastErr = e instanceof FetchError ? e : new FetchError(e.code || e.message);
      if (lastErr.permanent || (lastErr.status >= 400 && lastErr.status < 500 && lastErr.status !== 429)) break;
      await sleep(3000);
    }
  }
  throw lastErr;
}

/** 偵測機器人防護（例如 Imperva/Incapsula 的 JavaScript 驗證頁） */
export function isBotChallenge(html) {
  return /_Incapsula_Resource|cf-browser-verification|challenge-platform|Request unsuccessful\. Incapsula/i.test(html.slice(0, 3000));
}

/** 小型轉址頁（meta refresh 或 location.href）→ 目的網址 */
export function softRedirectTarget(html, baseUrl) {
  if (html.length > 6000) return null;
  const m =
    /<meta[^>]+http-equiv=["']?refresh["']?[^>]*content=["']?\s*\d+\s*;\s*url=['"]?([^'">\s]+)/i.exec(html) ||
    /(?:document|window)\.location(?:\.href)?\s*=\s*['"]([^'"]+)['"]/i.exec(html.replace(/\/\*[\s\S]*?\*\//g, ''));
  if (!m) return null;
  try {
    return new URL(m[1], baseUrl).href;
  } catch {
    return null;
  }
}

/** 取得 HTML 頁面，並跟隨小型轉址頁（最多 2 次） */
export async function fetchPage(url, opts = {}) {
  let res = await fetchResource(url, opts);
  for (let i = 0; i < 2; i++) {
    const next = softRedirectTarget(res.text, res.url);
    if (!next || next === res.url) break;
    res = await fetchResource(next, opts);
  }
  if (isBotChallenge(res.text)) throw new FetchError('網站啟用機器人防護（需瀏覽器驗證），無法自動讀取');
  return res;
}

/** 以有限並行處理工作 */
export async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
  return results;
}
