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
  let seg = t.slice(m.index + m[0].length, m.index + m[0].length + 420);
  // 遇到下一個條款標號或下一個段落標題即停止
  seg = seg.split(/\n?\s*(?:[一二三四五六七八九十]+、|第[一二三四五六七八九十]+[條點])/)[0];
  seg = seg.split(/\s*(?:補助條件|補助範圍|補助產品|補助項目|補助內容|補助金額|補助額度|補助比例|申請程序|申請方式|申請期間|受理期間|應備文件|申請條件|辦理方式|輔導方式)/)[0];
  seg = seg
    .replace(/[.…·．‧]{3,}\s*\d*/g, ' ') // 目錄的點線與頁碼
    .replace(/\s*\n\s*/g, ' ')
    .trim();
  // 必須是一段實際文字（不是表格欄位或目錄）
  if (/^[，,。、；;）)]/.test(seg)) return null;
  if ((seg.match(/[一-鿿]/g) || []).length < 4) return null;
  return seg.length > 400 ? seg.slice(0, 400) + '…' : seg;
}

// 補助對象分類（6 類，與網站顏色標籤一致）。規則判斷，不使用 AI。
export const TARGET_CATEGORIES = ['服務業', '工業', '機關學校', '醫院／長照', '農業', '民眾'];
const CATEGORY_RULES = [
  ['服務業', /服務業|商業|旅館|旅宿|飯店|民宿|餐飲|零售|批發|商店|店家|百貨|量販|商辦|辦公大樓|營業場所|營利事業|ESCO|能源技術服務|節能服務業/],
  ['工業', /製造業|工廠|工業|產業園區|製程|廠商|造紙|紡織|石化|鋼鐵/],
  ['機關學校', /機關|學校|大專校院|國中小|公立|公有|政府/],
  ['醫院／長照', /醫院|醫療院所|醫療機構|醫事機構|診所|長照|長期照顧|照顧機構|福利機構|護理之家/],
  ['農業', /農民|農會|漁會|漁業|畜牧|農業|農企業|養殖|農產品/],
  ['民眾', /住宅|家庭|民眾|自然人|個人|國民|住戶|消費者|買受人|家電/],
];

/**
 * 以補助對象原文（沒有時用標題）判斷類別。
 * 「依法設立之法人／公司／企業」未限定產業時，服務業與工業都適用。
 */
export function classifyTargetTypes(text) {
  // 「主管機關核准」等用語不代表補助對象是機關
  const t = normalizeText(text || '').replace(/(目的事業)?主管機關|中央機關|地方機關|機關核准/g, '');
  const types = new Set(CATEGORY_RULES.filter(([, re]) => re.test(t)).map(([n]) => n));
  if (/(依法設立|依法辦理)[^。；]{0,12}(法人|公司|企業|登記)|^\s*法人|公司登記|商業登記/.test(t) && !/服務業部門|商業服務業/.test(t)) {
    types.add('服務業');
    types.add('工業');
  }
  return TARGET_CATEGORIES.filter((c) => types.has(c));
}

const ACTION = /(補助|獎勵|汰換|導入|改善|購置|設置|輔導|退還|示範)/;
const PURPOSE = /(為(協助|鼓勵|推動|促進|輔導|提升|加速|落實)|藉由|鼓勵|協助|落實|目的|宗旨)/;
const NOISE = /(聯絡|窗口|技士|承辦|專員|科長|洽詢|客服|專線|郵寄|線上辦理|受理申請單位|專案辦公室|申請時間|申請方式|備註|注意事項|說明會|依\s*據|准駁|撤銷|廢止|委任|委託|法令|辦法第|要點第|申請書|附件|聯絡|電話|傳真|地址|網址|https?:|檢附|應備|文件|簽約|核銷|撥款|切結|公職人員|送達|郵戳|發文|瀏覽|登入|下載)/;
const ENERGY_HINT = /節能|節電|能源|能效|高效率|汰換|空調|照明|冷凍|冷藏|冷卻|熱泵|馬達|空壓|廢熱|ESCO/;

/**
 * 補助重點：從官方原文挑出最能說明「補助什麼」的一句，再精簡為 1~2 個分句（約 70 字內）。
 * 純規則判斷，只會刪減原文，不會新增官方沒寫的內容。
 */
/** 既有的補助重點是否仍符合目前的品質規則（舊版擷取的公文套語會被淘汰） */
export function briefLooksValid(s) {
  if (!s) return false;
  const t = normalizeText(s);
  return !NOISE.test(t) && !/^公告|公告。?$|如附件|旨揭/.test(t) && (ACTION.test(t) || ENERGY_HINT.test(t));
}

export function extractBrief(text, title = '') {
  const t = normalizeText(text || '');
  const sentences = t
    .split(/[。\n]/)
    .map((s) => s.replace(/^\s*(?:[一二三四五六七八九十]+、|[（(][一二三四五六七八九十\d]+[）)]|\d+[.、]|主\s*旨\s*[:：]|辦理目的|計畫目的|目的\s*[:：]?)\s*/, '').trim())
    .filter((s) => s.length >= 12 && s.length <= 260 && /[一-鿿]/.test(s));
  let best = null;
  let bestScore = -Infinity;
  sentences.slice(0, 60).forEach((s, i) => {
    let score = 0;
    if (ACTION.test(s)) score += 3;
    if (ENERGY_HINT.test(s)) score += 2;
    if (PURPOSE.test(s)) score += 1;
    if (NOISE.test(s)) score -= 4;
    if (/^公告|公告$|事宜$/.test(s)) score -= 3;
    if (/(期間|日期|截止|受理申請期間|受理時間|為限|同一年度|不得|須於)/.test(s)) score -= 3;
    // 只有計畫或法規名稱、沒有說明內容的句子
    if (s.length < 32 && /(要點|辦法|須知|計畫|作業|專案)。?$/.test(s)) score -= 3;
    if (title && s.includes(title.slice(0, 12))) score -= 1;
    score -= i * 0.05;
    if (score > bestScore) {
      bestScore = score;
      best = s;
    }
  });
  if (!best || bestScore < 3) return null;
  const clauses = best.split(/[，,；;]/).map((c) => c.trim()).filter(Boolean);
  let start = clauses.findIndex((c) => ACTION.test(c));
  if (start < 0) start = 0;
  const out = [];
  let len = 0;
  for (let i = start; i < clauses.length; i++) {
    const c = clauses[i].replace(/^(透過|藉由|經由|並|以|將|期能|期)\s*/, '');
    if (len && len + c.length > 70) break;
    out.push(c);
    len += c.length;
    if (len >= 28 && out.some((x) => ENERGY_HINT.test(x))) break;
  }
  // 尚未提到節能面向時，補上後面第一個提到節能的分句
  if (!out.some((x) => ENERGY_HINT.test(x))) {
    const e = clauses.slice(start + out.length).find((c) => ENERGY_HINT.test(c) && len + c.length <= 85);
    if (e) out.push(e.replace(/^(同時|並|以|將)\s*/, ''));
  }
  const brief = out.join('，').replace(/[，、]+$/, '');
  return brief.length >= 10 ? `${brief.slice(0, 90)}。` : null;
}

/** 受託執行單位（官方原文「委託財團法人XX辦理」） */
export function extractDelegate(text) {
  const m = /委託\s*((?:財團法人|社團法人)[^\s，,。、；;（(]{2,24}?)\s*(?:辦理|執行|承辦)/.exec(normalizeText(text || ''));
  return m ? m[1] : null;
}

/** 公告中的計畫識別資訊：發文字號、引號中的計畫名稱 */
export function extractIdentifiers(title, text) {
  const t = normalizeText(text || '');
  // 發文字號：有「發文字號：」標籤，或公文中單獨出現的「經授能字第11404024050號」
  const doc = /發文字號\s*[:：]?\s*([^\n\s]{4,30}號)/.exec(t) || /(?<![一-鿿])([一-鿿]{1,5}字第\d{8,13}號)/.exec(t);
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
    period_varies: !!period.varies,
    // 法規本文（要點、辦法…）只是規定「用罄時得提前截止」，不代表已經發生
    status_flag: /(要點|辦法|規定|須知|準則|條例|規範)$/.test(normalizeText(title || '').trim()) ? null : detectStatusFlag(body),
    amount_text: amountAll.text,
    amount_details: amountAll.details,
    target,
    target_types: classifyTargetTypes(`${title}\n${target || ''}\n${ids.programName || ''}`),
    // 補助重點：網頁內文優先，網頁沒有才看附件
    summary: extractBrief(body, title) || extractBrief(attachmentText, title),
    doc_no: ids.docNo,
    program_name: ids.programName,
    delegate: extractDelegate(body),
  };
}
