import {
  computeStatus, isNew, hotInfo, sortSubsidies, formatDate, formatDateTime, taipeiDate, periodText, UNKNOWN,
} from './logic.js';

const $ = (sel) => document.querySelector(sel);

const state = {
  subsidies: [],
  serverOffset: 0, // 伺服器時間 - 本機時間（避免使用者電腦時間不準）
  filter: { status: '', agency: '', target: '' },
  officialUrls: new Set(),
};

const now = () => Date.now() + state.serverOffset;

// ---------- 安全的 DOM 建立（一律以文字節點輸出，避免 XSS） ----------
function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c != null && c !== false) node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return node;
}

function safeHref(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : null;
  } catch {
    return null;
  }
}

const fmtInt = (n) => Number(n || 0).toLocaleString('zh-TW');

// ---------- 時鐘 ----------
function tick() {
  $('#now').textContent = formatDateTime(now());
}

// ---------- 篩選 ----------
const STATUS_FILTERS = [
  ['', '全部'],
  ['open', '🟢 申請中'],
  ['upcoming', '🟡 尚未開始'],
  ['closed', '⚫ 已截止'],
  ['unknown', '⚪ 期程請見官方公告'],
];

function matches(s, f, skip) {
  if (skip !== 'status' && f.status && computeStatus(s, now()).key !== f.status) return false;
  if (skip !== 'agency' && f.agency && s.agency !== f.agency) return false;
  if (skip !== 'target' && f.target && !(s.target_types || []).includes(f.target)) return false;
  return true;
}

function renderFilters() {
  const box = $('#f-status');
  box.replaceChildren();
  for (const [key, label] of STATUS_FILTERS) {
    const count = state.subsidies.filter((s) => matches(s, { ...state.filter, status: key }, key ? null : 'status')).length;
    if (key === 'unknown' && !count) continue;
    box.append(
      el('button', {
        type: 'button', class: 'chip', 'aria-pressed': String(state.filter.status === key),
        onclick: () => { state.filter.status = key; render(); },
      }, label, el('span', { class: 'count', text: `(${count})` })),
    );
  }
  fillSelect($('#f-agency'), [...new Set(state.subsidies.map((s) => s.agency))].sort((a, b) => a.localeCompare(b, 'zh-Hant')), state.filter.agency);
  const types = [...new Set(state.subsidies.flatMap((s) => s.target_types || []))];
  fillSelect($('#f-target'), types, state.filter.target);
}

function fillSelect(select, values, current) {
  select.replaceChildren(el('option', { value: '', text: '全部' }), ...values.map((v) => el('option', { value: v, text: v, selected: v === current })));
  select.value = current;
}

// ---------- 卡片 ----------
function metaItem(label, value) {
  const unknown = !value || value === UNKNOWN;
  return el('div', {}, el('dt', { text: label }), el('dd', { class: unknown ? 'unknown' : null, text: unknown ? UNKNOWN : value }));
}

function statusBadge(st) {
  return el('span', { class: `badge st-${st.key}` }, `${st.light} ${st.label}${st.reason ? `（${st.reason}）` : ''}`);
}

function card(s) {
  const t = now();
  const st = computeStatus(s, t);
  const hot = hotInfo(s, t);
  const fresh = isNew(s, t);
  const official = safeHref(s.official_url);
  const detailId = `detail-${s.id}`;
  const viewsEl = el('span', { class: 'card-views', text: `瀏覽 ${fmtInt(s.views)} 次` });
  const detailBox = el('div', { class: 'detail', id: detailId, hidden: true });
  const toggle = el('button', { type: 'button', class: 'btn-ghost', 'aria-expanded': 'false', 'aria-controls': detailId }, '詳細資訊 ▾');
  toggle.addEventListener('click', () => toggleDetail(s, toggle, detailBox, viewsEl));

  return el('article', { class: `card${st.key === 'closed' ? ' is-closed' : ''}` },
    el('div', { class: 'badges' },
      statusBadge(st),
      fresh && el('span', { class: 'badge b-new', text: 'NEW' }),
      hot && el('span', { class: 'badge b-hot', text: `🔥 即將截止・${hot.text}` }),
      s.link_status === 'dead' && el('span', { class: 'badge b-dead', text: '官方連結已失效' }),
      s.carried_over && el('span', { class: 'badge b-carry', text: `${s.year} 年公告・今年仍受理` }),
    ),
    el('h2', { text: s.title }),
    el('p', { class: 'agency', text: s.delegate ? `${s.agency}（受託執行單位：${s.delegate}）` : s.agency }),
    el('dl', { class: 'meta' },
      metaItem('公告日期', s.announce_date ? formatDate(s.announce_date) : null),
      metaItem('補助期間', periodText(s)),
      metaItem('補助對象', s.target),
      metaItem('最高補助金額', s.amount_text),
    ),
    s.summary && el('p', { class: 'brief', text: s.summary }),
    el('div', { class: 'card-foot' },
      viewsEl,
      el('div', { class: 'actions' },
        toggle,
        official && el('a', { class: 'btn-primary', href: official, target: '_blank', rel: 'noopener noreferrer' }, '前往官方網站 ↗'),
      ),
    ),
    detailBox,
  );
}

const detailCache = new Map();

async function toggleDetail(s, btn, box, viewsEl) {
  const open = btn.getAttribute('aria-expanded') === 'true';
  if (open) {
    btn.setAttribute('aria-expanded', 'false');
    btn.textContent = '詳細資訊 ▾';
    box.hidden = true;
    return;
  }
  btn.setAttribute('aria-expanded', 'true');
  btn.textContent = '收合 ▴';
  box.hidden = false;
  // 主動點開才計算瀏覽次數
  api(`/api/subsidies/${s.id}/view`, { method: 'POST' })
    .then((r) => {
      s.views = r.views;
      viewsEl.textContent = `瀏覽 ${fmtInt(r.views)} 次`;
    })
    .catch(() => {});
  if (!detailCache.has(s.id)) {
    box.replaceChildren(el('p', { class: 'small', text: '載入中…' }));
    try {
      detailCache.set(s.id, await api(`/api/subsidies/${s.id}`));
    } catch {
      box.replaceChildren(el('p', { class: 'warn', text: '詳細資料暫時無法載入，請直接前往官方網站查看。' }));
      return;
    }
  }
  renderDetail(detailCache.get(s.id), box);
}

function section(title, ...content) {
  return el('section', {}, el('h3', { text: title }), ...content);
}

function renderDetail(d, box) {
  const parts = [];
  const links = (list) => el('ul', {}, list.map((a) => {
    const href = safeHref(a.url || a);
    return el('li', {}, href ? el('a', { href, target: '_blank', rel: 'noopener noreferrer', text: a.label || a.url || a }) : String(a.label || a));
  }));
  parts.push(
    d.link_status === 'dead' && el('p', { class: 'warn', text: '官方網址目前無法開啟，可能已下架或改版；以下為先前擷取的官方原文。' }),
    section('申請期間', el('p', { text: periodText(d) }), d.deadline_text && el('p', { class: 'small', text: `官方原文：${d.deadline_text}` })),
    section('補助對象', el('p', { text: d.target || UNKNOWN })),
    section('補助金額', el('p', { text: d.amount_text || UNKNOWN }), d.amount_details?.length > 1 && el('ul', {}, d.amount_details.map((x) => el('li', { text: x })))),
    section('補助內容（官方原文擷取）', el('div', { class: 'content', text: d.content || d.summary || UNKNOWN })),
    d.attachments?.length && section('官方附件', links(d.attachments)),
    d.source_urls?.length > 1 && section('其他官方來源', links(d.source_urls.filter((u) => u !== d.official_url))),
    el('p', { class: 'small', text: `資料編號：${d.id}　首次發現：${formatDateTime(Date.parse(d.first_seen_at), false)}　最後更新：${formatDateTime(Date.parse(d.updated_at), false)}${d.manual ? '　（已人工校正）' : ''}` }),
  );
  box.replaceChildren(...parts.filter((x) => x instanceof Node));
}

// ---------- 主畫面 ----------
function render() {
  renderFilters();
  const t = now();
  const filtered = sortSubsidies(state.subsidies.filter((s) => matches(s, state.filter)), t);
  const list = $('#list');
  list.replaceChildren();
  const openCount = state.subsidies.filter((s) => computeStatus(s, t).key === 'open').length;
  const hotCount = state.subsidies.filter((s) => hotInfo(s, t)).length;
  $('#summary').replaceChildren(
    `本年度共收錄 `, el('strong', { text: String(state.subsidies.length) }), ` 筆，申請中 `, el('strong', { text: String(openCount) }),
    ` 筆${hotCount ? `，其中 ${hotCount} 筆即將截止` : ''}。`,
    filtered.length !== state.subsidies.length ? `目前篩選顯示 ${filtered.length} 筆。` : '',
  );
  if (!filtered.length) {
    list.append(el('div', { class: 'state-msg', text: state.subsidies.length ? '沒有符合篩選條件的補助，請點「全部」恢復完整清單。' : '目前尚無本年度符合條件的節能補助資料，系統每 30 分鐘自動檢查官方網站。' }));
    return;
  }
  for (const s of filtered) list.append(card(s));
}

async function api(path, init = {}) {
  const res = await fetch(path, { ...init, headers: { 'content-type': 'application/json', ...(init.headers || {}) } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || `HTTP ${res.status}`), { data });
  return data;
}

async function load({ countView = false } = {}) {
  try {
    const data = await api('/api/subsidies');
    state.serverOffset = data.server_time - Date.now();
    state.subsidies = data.subsidies || [];
    state.officialUrls = new Set(state.subsidies.map((s) => s.official_url));
    $('#updated').textContent = data.last_data_change_at ? formatDate(taipeiDate(Date.parse(data.last_data_change_at))) : '尚無資料';
    tick();
    render();
    // 首頁成功載入才計算全站瀏覽（自動重新整理不重複計算）
    if (countView) api('/api/view', { method: 'POST' })
      .then((r) => ($('#site-views').textContent = `累積瀏覽：${fmtInt(r.site_views)} 次`))
      .catch(() => {});
  } catch {
    $('#list').replaceChildren(el('div', { class: 'state-msg', text: '資料暫時無法載入，請稍後重新整理。' }));
  }
}

// ---------- 智慧小幫手 ----------
const EXAMPLES = ['我是旅館，有什麼補助可以申請？', '我要換冰水主機有補助嗎？', '目前有哪些補助快截止？', '最高可以補助多少？'];
let chatBusy = false;

function addMsg(kind, text) {
  const node = el('div', { class: `msg ${kind}` });
  if (kind === 'bot') {
    // 只把本站收錄的官方網址轉成連結，其餘維持純文字
    const parts = String(text).split(/(https?:\/\/[A-Za-z0-9\-._~:/?#[\]@!$&*+,;=%]+)/g);
    for (const p of parts) {
      const clean = p.replace(/[。，、；．.,;]+$/, '');
      if (/^https?:\/\//.test(p) && state.officialUrls.has(clean) && safeHref(clean)) {
        node.append(el('a', { href: clean, target: '_blank', rel: 'noopener noreferrer', text: clean }), p.slice(clean.length));
      } else node.append(p);
    }
  } else node.textContent = text;
  $('#chat-log').append(node);
  node.scrollIntoView({ block: 'end' });
}

function setRemaining(remaining, limit) {
  $('#chat-remaining').textContent = `今日剩餘 ${remaining} 次`;
  const out = remaining <= 0;
  $('#chat-input').disabled = out;
  $('#chat-send').disabled = out;
  if (out) $('#chat-input').placeholder = `您今日的 ${limit} 次智慧小幫手使用額度已用完，明日即可再次使用。`;
}

async function refreshQuota() {
  try {
    const q = await api('/api/ask');
    setRemaining(q.remaining, q.limit);
    if (!q.available) $('#chat-remaining').textContent = '（目前暫時無法使用）';
  } catch {
    /* 略過 */
  }
}

async function ask(question) {
  if (chatBusy || !question.trim()) return;
  chatBusy = true;
  $('#chat-send').disabled = true;
  addMsg('user', question);
  const waiting = el('div', { class: 'msg bot', text: '查詢本站資料中…' });
  $('#chat-log').append(waiting);
  try {
    const r = await api('/api/ask', { method: 'POST', body: JSON.stringify({ question }) });
    waiting.remove();
    if (r.ok) addMsg('bot', r.answer);
    else addMsg('sys', r.message);
    setRemaining(r.remaining, r.limit);
  } catch (e) {
    waiting.remove();
    addMsg('sys', e.data?.error || '智慧小幫手目前暫時無法使用，請稍後再試。');
  } finally {
    chatBusy = false;
    if (!$('#chat-input').disabled) $('#chat-send').disabled = false;
  }
}

function initChat() {
  const chat = $('#chat');
  const fab = $('#chat-open');
  $('#chat-examples').append(...EXAMPLES.map((q) => el('button', { type: 'button', text: q, onclick: () => ask(q) })));
  fab.addEventListener('click', () => {
    chat.hidden = false;
    fab.hidden = true;
    refreshQuota();
    $('#chat-input').focus();
  });
  $('#chat-close').addEventListener('click', () => {
    chat.hidden = true;
    fab.hidden = false;
    fab.focus();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !chat.hidden) $('#chat-close').click();
  });
  $('#chat-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = $('#chat-input');
    const q = input.value.trim().slice(0, 200);
    input.value = '';
    ask(q);
  });
  $('#chat-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      $('#chat-form').requestSubmit();
    }
  });
}

// ---------- 啟動 ----------
$('#f-agency').addEventListener('change', (e) => { state.filter.agency = e.target.value; render(); });
$('#f-target').addEventListener('change', (e) => { state.filter.target = e.target.value; render(); });
$('#f-reset').addEventListener('click', () => { state.filter = { status: '', agency: '', target: '' }; render(); });

tick();
setInterval(tick, 1000);
// 跨日時重新整理狀態（NEW、剩餘天數）；每 30 分鐘重新讀取最新資料
let lastDay = taipeiDate(now());
setInterval(() => {
  const d = taipeiDate(now());
  if (d !== lastDay) {
    lastDay = d;
    load();
  }
}, 60 * 1000);
setInterval(load, 30 * 60 * 1000);

initChat();
load({ countView: true });
