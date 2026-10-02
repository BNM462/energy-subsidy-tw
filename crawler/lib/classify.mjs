// 判斷是否為「節能相關補助」。
// 判定看實際內容，不是看名稱有沒有「節能」兩字。

import { normalizeText } from './dates.mjs';

// 標題必須像是補助／獎勵的公告（避免把新聞報導、活動當成補助）
export const SUBSIDY_TITLE = /補助|獎勵|補貼|獎補助|補捐助|受理申請|申請作業|徵件|徵求|汰舊換新|汰換/;

// 明顯不是補助公告
export const NEGATIVE_TITLE =
  /徵才|職缺|錄取|甄選結果|甄試|招標|決標|標案|採購|得標|補助名單|核定名單|獲補助|審查結果|評選結果|得獎|頒獎|表揚|標竿獎|研討會|研習|講習|座談|訓練課程|成果發表|成果分享|分享會|觀摩會|成果|新聞澄清|稅式支出|躉購費率|調訓|職務代理人|誠徵|招募|成果展|核定結果|受補助單位名單|代售|出版品|徵求意見|預告|專區$|核定專區|業務揭露|計畫構想書|科技專案|土地|標售|出租|租賃|公聽會|說明會|活動花絮|插畫|徵文|攝影|試算|立即申請|申請系統|系統登入|會員登入/;

// 實質節能／能源效率內容（每個詞組視為一個獨立訊號）
export const ENERGY_TERMS = [
  ['節能', /節能(?!標竿)/],
  ['節約能源', /節約能源/],
  ['能源效率', /能源效率|能效標示|能效分級|一級能效|能源使用效率/],
  ['節電', /節電|省電/],
  ['高效率設備', /高效率(設備|馬達|空調|照明|冷氣|冰水|空壓|鍋爐|熱泵|動力|產品|電動機|變壓器|燈)/],
  ['設備汰換', /汰換|汰舊換新|老舊設備/],
  ['空調', /空調|冷氣|冰水主機|冷凍空調|箱型冷氣|冷卻水塔/],
  ['照明', /照明|LED|燈具/],
  ['馬達動力', /馬達|電動機|空壓機|空氣壓縮機|泵浦|風機|變頻|動力與公用設備|動力及公用設備/],
  ['鍋爐熱泵', /鍋爐|熱泵|熱水器/],
  ['ESCO', /ESCO|節能服務業|節能績效保證|能源技術服務/],
  ['能源管理', /能源管理系統|EMS|能源管理|能源查核|節能診斷|智慧能源管理/],
  ['建築節能', /建築節能|建築物節能|外殼節能|綠建築/],
  ['深度節能', /深度節能/],
  ['製程節能', /製程(改善|節能|優化)|製程設備/],
  ['廢熱回收', /廢熱|廢冷|餘熱|熱回收/],
  ['冷凍冷藏', /冷凍櫃|冷藏櫃|冷凍冷藏/],
];

// 若「只有」這些內容而無實質節能，排除
export const EXCLUDE_ONLY = /太陽光電|光電|再生能源|儲能|電動車|電動機車|充電樁|充電站|碳盤查|碳足跡|淨零|減碳顧問|風電|風力|地熱|氫能|燃料電池|生質能|小水力|微電網|公民電廠|石油|天然氣/;

export function energySignals(text) {
  const t = normalizeText(text);
  return ENERGY_TERMS.filter(([, re]) => re.test(t)).map(([name]) => name);
}

/**
 * 判斷標題是否值得進一步抓內文（節省對政府網站的請求）。
 */
export function titleWorthFetching(title) {
  const t = normalizeText(title);
  if (NEGATIVE_TITLE.test(t)) return false;
  return SUBSIDY_TITLE.test(t);
}

// 核心節能詞：內文判定時至少要有一個（避免只因「照明」「綠建築」等附帶字眼誤判）
const CORE = new Set(['節能', '節約能源', '能源效率', '節電', 'ESCO', '能源管理', '深度節能', '廢熱回收', '高效率設備']);

/**
 * 以標題＋內文判斷。回傳 { isSubsidy, reason, signals }
 */
export function classify({ title, text }) {
  const t = normalizeText(title);
  const body = normalizeText(text || '');
  if (NEGATIVE_TITLE.test(t)) return { isSubsidy: false, reason: '非補助公告', signals: [] };
  if (!SUBSIDY_TITLE.test(t)) return { isSubsidy: false, reason: '非補助公告', signals: [] };
  const titleSignals = energySignals(t);
  // 「節能減碳」是公文常見套語，內文判定時不單獨計入
  const bodySignals = energySignals(body.replace(/推動節能減碳|節能減碳政策|節能減碳/g, ''));
  const signals = [...new Set([...titleSignals, ...bodySignals])];

  // 標題有節能訊號，或內文有 2 種以上訊號且含核心節能詞
  const strong = titleSignals.length >= 1 || (bodySignals.length >= 2 && bodySignals.some((s) => CORE.has(s)));
  if (!strong) {
    return { isSubsidy: false, reason: EXCLUDE_ONLY.test(t + body) ? '僅再生能源／減碳等，無實質節能內容' : '無節能相關內容', signals };
  }
  // 標題本身是再生能源等主題，且標題沒有任何節能訊號 → 需要內文有更多節能證據
  if (EXCLUDE_ONLY.test(t) && titleSignals.length === 0 && bodySignals.length < 3) {
    return { isSubsidy: false, reason: '僅再生能源／減碳等，無實質節能內容', signals };
  }
  return { isSubsidy: true, reason: '含節能／能源效率內容', signals };
}
