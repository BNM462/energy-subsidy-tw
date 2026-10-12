// 新補助公告整理：請 Gemini 從官方公告與附件全文整理卡片欄位，並自動檢查數字都出自官方原文。
// 只在爬蟲發現新補助或公告內容變動時呼叫（每月約數次），使用伺服器端的 Gemini 免費額度。
import { callGemini } from './gemini.js';
import { normalizeText } from '../crawler/lib/dates.mjs';

export const MAX_SOURCE_CHARS = 60000;

const SYSTEM = `你是政府補助公告的整理助手。請閱讀使用者提供的【官方公告全文】（含附件），整理成網站卡片欄位。規則：
1. 只能使用全文中明確寫出的內容，不可推測、不可補充你自己的知識、不可加入官方沒寫的條件或說法（例如不可自行說明「有省錢才付費」這類詮釋）。
2. 數字（金額、比例、門檻、容量、家數）必須與原文一致；可把國字數字改寫成阿拉伯數字，但不可換算或加總。
3. 「補助金額」只指政府給申請者的補助或獎勵；下列都不是補助金額，一律忽略：罰鍰與罰則、公職人員利益衝突迴避相關表單與法條、試算範例或案例、付給輔導或執行單位的費用、計畫總預算。
4. 使用繁體中文與台灣用語，語氣中性、精簡；不寫「本計畫」「旨揭」等公文用語。
5. 全文中找不到的欄位填 null 或空陣列，不可編造。
欄位說明：
- summary：補助重點，1～2 句、80 字內。寫申請者最在意的內容：補助什麼（項目或設備）、補助比例上限或門檻（如節能率）、優先或加碼條件。
- amount_text：卡片「最高補助」欄，40 字內。例如「最高新臺幣 500 萬元」「補助比率最高 100%」「依設備項目定額補助」。有多種上限時寫最高者並加註「（依申請類型不同）」。
- amount_details：金額明細條列，最多 8 條，每條 80 字內（各類別上限、補助比例、加碼條件、每家上限等）。
- target_points：補助對象條列，最多 6 條，每條 60 字內（申請資格、規模門檻、適用場所）。`;

const SCHEMA = {
  type: 'OBJECT',
  properties: {
    summary: { type: 'STRING', nullable: true },
    amount_text: { type: 'STRING', nullable: true },
    amount_details: { type: 'ARRAY', items: { type: 'STRING' } },
    target_points: { type: 'ARRAY', items: { type: 'STRING' } },
  },
  required: ['summary', 'amount_text', 'amount_details', 'target_points'],
};

// ---------- 數字檢查：AI 寫出的每個數字都必須出現在官方原文 ----------
const CN_DIGIT = { 零: 0, 〇: 0, 一: 1, 二: 2, 兩: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
const CN_UNIT = { 十: 10, 百: 100, 千: 1000 };

/** 國字數字（萬以下，例：一千五百、三十五、十）轉阿拉伯數字 */
export function cnInt(s) {
  let total = 0;
  let digit = null;
  for (const ch of s) {
    if (ch in CN_DIGIT) digit = CN_DIGIT[ch];
    else if (ch in CN_UNIT) {
      total += (digit ?? 1) * CN_UNIT[ch];
      digit = null;
    } else return null;
  }
  return total + (digit ?? 0);
}

const CN_RUN = /[零〇一二兩三四五六七八九十百千]+/g;

/** 把文字中的數字統一成阿拉伯數字（百分之三十 → 30%、三分之一 → 1/3、一百十五年 → 115年） */
export function normalizeNumbers(text) {
  return normalizeText(String(text || ''))
    .replace(/百分之([零〇一二兩三四五六七八九十百千]+)/g, (m, n) => `${cnInt(n) ?? n}%`)
    .replace(/([零〇一二兩三四五六七八九十]+)分之([零〇一二兩三四五六七八九十]+)/g, (m, a, b) => `${cnInt(b) ?? b}/${cnInt(a) ?? a}`)
    .replace(CN_RUN, (m) => String(cnInt(m) ?? m))
    .replace(/(\d),(?=\d{3})/g, '$1');
}

function numbersIn(text) {
  return normalizeNumbers(text).match(/\d+(?:\.\d+)?/g) || [];
}

/** 欄位文字中的數字是否都出現在原文（找不到任何一個就不採用該欄位） */
export function numbersFromSource(fieldText, sourceNumbers) {
  return numbersIn(fieldText).every((n) => sourceNumbers.has(n) || sourceNumbers.has(String(+n)));
}

const str = (v, max) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
const list = (v, n, max) => (Array.isArray(v) ? v.map((x) => str(x, max)).filter(Boolean).slice(0, n) : []);

/** 整理 AI 回傳內容：限制長度，並捨棄數字對不上原文的欄位或條目 */
export function sanitizeFields(raw, sourceText) {
  const nums = new Set(numbersIn(sourceText).flatMap((n) => [n, String(+n)]));
  const dropped = [];
  const keep = (name, v) => {
    if (v == null) return null;
    if (numbersFromSource(v, nums)) return v;
    dropped.push(`${name}：${v}`);
    return null;
  };
  const out = {
    summary: keep('summary', str(raw?.summary, 160)),
    amount_text: keep('amount_text', str(raw?.amount_text, 80)),
    amount_details: list(raw?.amount_details, 8, 120).map((x) => keep('amount_details', x)).filter(Boolean),
    target_points: list(raw?.target_points, 6, 100).map((x) => keep('target_points', x)).filter(Boolean),
  };
  // 金額明細的數字有錯時，連同卡片上的最高補助一起不採用（避免只剩部分正確的金額資訊）
  if (dropped.some((d) => d.startsWith('amount_details'))) {
    if (out.amount_text) dropped.push(`amount_text：${out.amount_text}（明細有誤，一併不採用）`);
    out.amount_text = null;
    out.amount_details = [];
  }
  return { fields: out, dropped };
}

export async function extractWithAI(env, { title, agency, text }, opts = {}) {
  const source = String(text || '').slice(0, MAX_SOURCE_CHARS);
  const r = await callGemini(env, {
    system: SYSTEM,
    user: `主辦機關：${agency || '未載明'}\n公告標題：${title || '未載明'}\n\n【官方公告全文】\n${source}\n【全文結束】`,
    schema: SCHEMA,
    maxOutputTokens: 4096,
    ...opts,
  });
  if (!r.ok) return r;
  let raw;
  try {
    raw = JSON.parse(r.text);
  } catch {
    return { ok: false, reason: 'bad_json' };
  }
  const { fields, dropped } = sanitizeFields(raw, `${title}\n${source}`);
  return { ok: true, model: r.model, fields, dropped };
}
