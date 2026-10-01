// 所有 /api/* 共用：安全標頭、CORS、來源檢查、錯誤處理。
import { error, isAllowedOrigin } from '../../server/http.js';

const SECURITY_HEADERS = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'x-frame-options': 'DENY',
};

export async function onRequest(context) {
  const { request, env, next } = context;
  const url = new URL(request.url);
  const origin = request.headers.get('origin');
  const isInternal = url.pathname.startsWith('/api/internal/');

  // 預檢請求：只允許正式網站來源
  if (request.method === 'OPTIONS') {
    if (!isInternal && isAllowedOrigin(origin, env)) {
      return new Response(null, {
        status: 204,
        headers: {
          'access-control-allow-origin': origin,
          'access-control-allow-methods': 'GET, POST',
          'access-control-allow-headers': 'content-type',
          'access-control-max-age': '86400',
          vary: 'origin',
        },
      });
    }
    return new Response(null, { status: 403 });
  }

  // 會改變計數的公開 API（POST）只接受本站網頁發出的請求
  if (!isInternal && request.method !== 'GET' && request.method !== 'HEAD') {
    if (!isAllowedOrigin(origin, env)) return error(403, '不允許的來源');
  }

  let res;
  try {
    res = await next();
  } catch (e) {
    console.error('API error', url.pathname, e?.message);
    res = error(500, '伺服器暫時無法處理，請稍後再試。');
  }
  res = new Response(res.body, res);
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.headers.set(k, v);
  if (!isInternal && isAllowedOrigin(origin, env)) {
    res.headers.set('access-control-allow-origin', origin);
    res.headers.append('vary', 'origin');
  }
  return res;
}
