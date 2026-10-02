// 從官方內文擷取補助欄位。原則：只擷取官方原文，抓不到就是 null（前台顯示「官方未明載」）。

import { normalizeText, extractPeriod, detectStatusFlag, extractAnnounceDate } from './dates.mjs';

const UNIT = { 億: 1e8, 萬: 1e4, 千: 1e3, 元: 1 };

/** 解析金額字串為新臺幣元，例如「1,500萬元」→ 15000000 */
export function parseAmount(s) {
  const m = /(\d[\d,]*(?:\.\d+)?)\s*(億|萬|千)?\s*元/.exec(normalizeText(s));
  if (!m) return null;
  const n = parseFloat(m[1].replace(/,/g, ''));
  if (!Number.isFinite(n)) return null;
  return Math.round(n * (m[2] ? UNIT[m[2]] : 1));
}

export function formatNtd(n) {
  if (n >= 1e8 && n % 1e6 === 0) return `新臺幣 ${(n / 1e8).toLocaleString('zh-TW')} 億元`;
  if (n >= 1e4 && n % 100 === 0) return `新臺幣 ${(n / 1e4).toLocaleString('zh-TW')} 萬元`;
  return `新臺幣 ${n.toLocaleString('zh-TW')} 元`;
}

const AMOUNT_CONTEXT = /(最高|上限|至多|每案|每家|每台|每臺|每戶|每件|補助|獎勵|補貼)/;
const AMOUNT_RE = /(?:新臺幣|新台幣|NT\$?)?\s*\d[\d,]*(?:\.\d+)?\s*(?:億|萬|千)?\s*元/g;

/**
 * 擷取補助金額。
 * 回傳 { text, details[] }；多種級距時以「最高新臺幣 X（依申請類型不同）」呈現，並保留原文細節。
 */
export function extractAmount(text) {
  // 「案例試算」等範例段落之後的金額都是示範計算，不列入
  const t = normalizeText(text).split(/\n\s*(?:案例試算|試算範例|計算範例|範例說明|試算說明)/)[0];
  const sentences = t.split(/[。；;\n]/);
  const found = [];
  for (const s of sentences) {
    if (!AMOUNT_CONTEXT.test(s)) continue;
    AMOUNT_RE.lastIndex = 0;
    let m;
    while ((m = AMOUNT_RE.exec(s))) {
      const before = s.slice(Math.max(0, m.index - 30), m.index);
      if (!AMOUNT_CONTEXT.test(before + m[0])) continue;
      // 金額前面緊鄰的是總經費、罰鍰等，就不是補助金額
      const clause = before.split(/[，,、；;]/).pop();
      if (/(總經費|總預算|預算總額|經費總額|罰鍰|保證金|手續費|規費|營業額|資本額|實收資本|年營收)/.test(clause)) continue;
      // 試算範例中的金額（購入價、乘上、等於…）不是補助上限
      if (/(購入價|購買價|售價|乘上|乘以|等於|案例|試算|例如|僅能獲得|預計申請)/.test(s.slice(Math.max(0, m.index - 24), m.index + m[0].length + 2))) continue;
      const value = parseAmount(m[0]);
      if (!value || value < 100) continue;
      // 原文片段：從前一個逗號之後到金額結束
      const lead = before.split(/[，,：:]/).pop();
      const after = s.slice(m.index + m[0].length, m.index + m[0].length + 6);
      const capAfter = /^\s*(為上限|為限|上限)/.exec(after);
      const snippet = (lead + m[0] + (capAfter ? capAfter[0] : '')).replace(/^[\s\d.()（）一二三四五六七八九十、]+/, '').trim();
      found.push({ value, snippet: snippet || m[0].trim(), cap: !!capAfter, ctx: before + m[0] });
    }
  }
  if (!found.length) return { text: null, details: [] };
  const distinct = [...new Map(found.map((f) => [f.value, f])).values()].sort((a, b) => b.value - a.value);
  const details = [...new Set(found.map((f) => f.snippet))].slice(0, 8);
  const max = distinct[0];
  const hasCap = max.cap || /(最高|上限|至多|為限)/.test(max.snippet);
  const perUnit = (f) => /每\s*(台|臺|具|瓩|kW|KW|戶|件|組|盞|座|套)/.test(f.ctx || f.snippet);
  let out;
  if (distinct.length > 1 && found.every(perUnit)) {
    // 依設備別定額補助：不挑單一數字，避免誤導
    out = `依設備項目定額補助（共 ${distinct.length} 種上限，詳見詳細資訊）`;
  } else if (distinct.length === 1) {
    out = hasCap ? `最高${formatNtd(max.value)}` : max.snippet;
  } else {
    out = `最高${formatNtd(max.value)}（依申請類型不同）`;
  }
  return { text: out, details };
}

const TARGET_LABEL = /(補助對象|申請對象|申請資格|適用對象|獎勵對象|補助範圍及對象|申請人資格|受補助對象|申請者資格|適用範圍)(?:\s*[:：]|\s*\n|為)\s*/g;

/** 擷取補助對象原文（取第一個有實際內容的「補助對象：…」） */
export function extractTarget(text) {
  const t = normalizeText(text);
  TARGET_LABEL.lastIndex = 0;
  let m;
  while ((m = TARGET_LABEL.exec(t))) {
    const v = targetAt(t, m);
    if (v) return v;
  }
  return null;
}

function targetAt(t, m) {
  let seg = t.slice(m.index + m[0].length, m.index + m[0].length + 220);
  // 遇到下一個條款標號即停止
  seg = seg.split(/\n?\s*(?:[一二三四五六七八九十]+、|第[一二三四五六七八九十]+[條點])/)[0];
  seg = seg
    .replace(/[.…·．‧]{3,}\s*\d*/g, ' ') // 目錄的點線與頁碼
    .replace(/\s*\n\s*/g, ' ')
    .trim();
  // 必須是一段實際文字（不是表格欄位或目錄）
  if (/^[，,。、；;）)]/.test(seg)) return null;
  if ((seg.match(/[一-鿿]/g) || []).length < 4) return null;
  return seg.length > 160 ? seg.slice(0, 160) + '…' : seg;
}

const TARGET_TYPE_RULES = [
  ['旅宿業', /旅館|旅宿|飯店|民宿|觀光旅館/],
  ['醫療院所', /醫院|醫療院所|診所|醫療機構/],
  ['機關／學校', /機關|學校|公立|大專校院|國中小|公有/],
  ['住宅／一般民眾', /住宅|家庭|民眾|自然人|個人|家電|國民|住戶/],
  ['農漁畜牧業', /農民|農會|漁會|漁業|畜牧|農業|農企業|養殖/],
  ['能源技術服務業（ESCO）', /ESCO|節能服務業|能源技術服務業|節能績效保證/],
  ['製造業／工廠', /製造業|工廠|工業|產業園區|廠商|企業/],
  ['服務業／商業', /服務業|商業|零售|餐飲|商店|量販|百貨|批發|商家|營業場所|事業單位/],
];

export function classifyTargetTypes(text) {
  const t = normalizeText(text || '');
  const types = TARGET_TYPE_RULES.filter(([, re]) => re.test(t)).map(([n]) => n);
  return types;
}

/** 內文摘要：取公告事項或第一段實質內容，不改寫 */
export function extractSummary(text, title) {
  const t = normalizeText(text).replace(new RegExp(escapeRe(title || '').slice(0, 60)), '');
  const lines = t
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length >= 15 && /[一-鿿]/.test(l))
    .filter((l) => !/^(發布日期|發文日期|發文字號|附件|署長|部長|局長|主任委員|相關檔案|檔案名稱|更新日期|瀏覽人次|發布單位|點閱)/.test(l));
  const subject = lines.find((l) => /^主\s*旨/.test(l));
  const first = subject || lines[0] || '';
  const s = first.replace(/^主\s*旨\s*[:：]\s*/, '');
  return s.length > 180 ? s.slice(0, 180) + '…' : s || null;
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 受託執行單位（官方原文「委託財團法人XX辦理」） */
export function extractDelegate(text) {
  const m = /委託\s*((?:財團法人|社團法人)[^\s，,。、；;（(]{2,24}?)\s*(?:辦理|執行|承辦)/.exec(normalizeText(text || ''));
  return m ? m[1] : null;
}

/** 公告中的計畫識別資訊：發文字號、引號中的計畫名稱 */
export function extractIdentifiers(title, text) {
  const t = normalizeText(text || '');
  const doc = /發文字號\s*[:：]?\s*([^\n\s]{4,30}號)/.exec(t);
  // 計畫名稱：標題中的「」，沒有就取主旨中的「」
  const subject = /主\s*旨\s*[:：][^\n]*/.exec(t);
  const quoted = /[「『]([^」』]{4,60})[」』]/.exec(normalizeText(title)) || (subject && /[「『]([^」』]{4,60})[」』]/.exec(subject[0])) || null;
  return { docNo: doc ? doc[1] : null, programName: quoted ? quoted[1] : null };
}

/**
 * 主要擷取函式。
 * input: { title, text, listDate, attachmentText }
 */
export function extractFields({ title, text, listDate = null, attachmentText = '' }) {
  const body = normalizeText(text || '');
  const all = body + '\n' + normalizeText(attachmentText || '');
  const announce = extractAnnounceDate(body) || listDate || null;
  // 期程以網頁內文為主，網頁沒有才看附件
  let period = extractPeriod(body, { announceDate: announce });
  if (!period.start && !period.end && attachmentText) period = extractPeriod(all, { announceDate: announce });
  const amount = extractAmount(body);
  const amountAll = amount.text ? amount : extractAmount(all);
  const target = extractTarget(body) || extractTarget(all);
  const ids = extractIdentifiers(title, body);
  return {
    announce_date: announce,
    apply_start: period.start,
    apply_end: period.end,
    apply_end_time: period.endTime,
    deadline_text: period.rawText,
    until_quota: period.untilQuota || /額滿為止|用罄為止/.test(all),
    status_flag: detectStatusFlag(body),
    amount_text: amountAll.text,
    amount_details: amountAll.details,
    target,
    target_types: classifyTargetTypes(`${title}\n${target || ''}`),
    summary: extractSummary(body, title),
    doc_no: ids.docNo,
    program_name: ids.programName,
    delegate: extractDelegate(body),
  };
}
