// API 共用：JSON 回應、來源檢查、常數時間比對。

export function json(data, init = {}) {
  const headers = new Headers(init.headers);
  headers.set('content-type', 'application/json; charset=utf-8');
  if (!headers.has('cache-control')) headers.set('cache-control', 'no-store');
  return new Response(JSON.stringify(data), { ...init, headers });
}

export function error(status, message) {
  return json({ error: message }, { status });
}

/** 允許的網站來源（正式網址、預覽網址、本機開發） */
export function allowedOrigins(env) {
  return String(env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export function isAllowedOrigin(origin, env) {
  if (!origin) return false;
  let u;
  try {
    u = new URL(origin);
  } catch {
    return false;
  }
  for (const allowed of allowedOrigins(env)) {
    if (allowed === origin) return true;
    // 例：https://*.energy-subsidy-tw.pages.dev（Cloudflare 預覽部署）
    const m = /^https:\/\/\*\.(.+)$/.exec(allowed);
    if (m && u.protocol === 'https:' && u.hostname.endsWith('.' + m[1])) return true;
  }
  return false;
}

/** 常數時間字串比對，避免以回應時間猜測密鑰 */
export function safeEqual(a, b) {
  const ea = new TextEncoder().encode(String(a));
  const eb = new TextEncoder().encode(String(b));
  let diff = ea.length ^ eb.length;
  const len = Math.max(ea.length, eb.length);
  for (let i = 0; i < len; i++) diff |= (ea[i] ?? 0) ^ (eb[i] ?? 0);
  return diff === 0;
}

/** 內部 API（爬蟲寫入）驗證：Authorization: Bearer <INGEST_TOKEN> */
export function checkInternalAuth(request, env) {
  const token = env.INGEST_TOKEN;
  if (!token || token.length < 32) return false;
  const h = request.headers.get('authorization') || '';
  const m = /^Bearer\s+(.+)$/.exec(h);
  return !!m && safeEqual(m[1], token);
}

export async function readJsonBody(request, maxBytes) {
  const len = Number(request.headers.get('content-length') || 0);
  if (len > maxBytes) throw new Error('too large');
  const text = await request.text();
  if (text.length > maxBytes) throw new Error('too large');
  return JSON.parse(text);
}
