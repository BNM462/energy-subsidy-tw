// HTML 解析：列表頁連結（含日期）、內文主體、附件。
import * as cheerio from 'cheerio';
import { findDates, normalizeText } from './dates.mjs';

// 注意：不可移除 form，ASP.NET 網站整頁都包在 <form> 內
const NOISE = 'script,style,noscript,iframe,svg,select,button,template,input,textarea';
const NAV_HINT = /(^|[\s_-])(nav|menu|footer|header|sidebar|breadcrumb|sitemap|topbar|toolbar|share|social|accesskey|banner|fatfooter|lang)/i;

export function load(html) {
  return cheerio.load(html);
}

function cleanText(s) {
  return normalizeText(s).replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();
}

/** 清理連結標題：去掉「另開新視窗」「移至」「到」等輔助文字與開頭日期 */
export function cleanTitle(s) {
  return normalizeText(s)
    .replace(/\s*[\(（]?(另開新視窗|開新視窗|另開視窗|新視窗開啟)[\)）]?\s*/g, '')
    .replace(/\n+/g, ' ')
    .replace(/^\s*(開新分頁下載|另開新分頁|移至|前往|連結至|連結到|下載|開啟|到)\s*/, '')
    .replace(/\s*[\(（]\s*[\d.]+\s*[KMG]?B\s*[\)）]\s*/gi, ' ')
    .replace(/\.(pdf|odt|docx?|ods|xlsx?)(\s*檔案)?\s*$/i, '')
    .replace(/\s*檔案\s*$/, '')
    .replace(/^\s*(\d{2,4}[-/.]\d{1,2}[-/.]\d{1,2}\s*)+/, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function absUrl(href, base) {
  try {
    const u = new URL(href, base);
    if (!/^https?:$/.test(u.protocol)) return null;
    u.hash = '';
    return u.href;
  } catch {
    return null;
  }
}

function inNav($, el) {
  let cur = el;
  for (let i = 0; i < 8 && cur && cur.type === 'tag'; i++) {
    const tag = cur.tagName;
    if (tag === 'nav' || tag === 'header' || tag === 'footer') return true;
    const cls = `${$(cur).attr('class') || ''} ${$(cur).attr('id') || ''}`;
    if (NAV_HINT.test(cls)) return true;
    cur = cur.parent;
  }
  return false;
}

/**
 * 從列表頁抓出所有文章連結。
 * 回傳 [{ url, title, date }]，date 為同一列（li/tr/div）中找到的第一個日期。
 */
export function extractListLinks(html, baseUrl) {
  const $ = load(html);
  $(NOISE).remove();
  const out = new Map();
  $('a[href]').each((_, a) => {
    const href = $(a).attr('href');
    if (!href || /^(javascript:|mailto:|tel:|#)/i.test(href)) return;
    const url = absUrl(href, baseUrl);
    if (!url) return;
    let title = cleanText($(a).attr('title') || '');
    const text = cleanText($(a).text());
    if (text.length >= title.length || /另開|新視窗|連結/.test(title)) title = text || title;
    title = cleanTitle(title);
    if (title.length < 6 || title.length > 200) return;
    if (inNav($, a)) return;
    // 同一列中的日期（排除標題本身，標題中的日期常是截止日而非公告日）
    let date = null;
    const row = $(a).closest('li,tr,article,.list-item,.item,dl,p');
    let rowText = row.length ? cleanText(row.text()).slice(0, 500) : '';
    rowText = rowText.replace(text, ' ').replace(title, ' ');
    // 連結文字開頭的日期（例：「(115-09-30) 標題」）也是發布日期
    const lead = /^\s*[\(（\[【]?\s*(\d{2,4}[-/.]\d{1,2}[-/.]\d{1,2})/.exec(text);
    // 連結文字結尾的「115-04-10」格式（衛福部等網站的發布日期寫法）
    const trail = /(\d{2,4}-\d{1,2}-\d{1,2})\s*$/.exec(text);
    const d = findDates(rowText)[0] || (lead && findDates(lead[1])[0]) || (trail && findDates(trail[1])[0]);
    if (d) date = d.iso;
    const prev = out.get(url);
    if (!prev || (!prev.date && date) || title.length > prev.title.length) out.set(url, { url, title, date: date || prev?.date || null });
  });
  return [...out.values()];
}

/**
 * 「表格列」模式：有些列表頁每列沒有獨立連結（例：能源署節能績效保證專區），
 * 改把每一列當成一則公告。網址使用列表頁網址加上 #識別碼（瀏覽器開啟仍是官方列表頁）。
 */
export function extractRowDocs(html, pageUrl) {
  const $ = load(html);
  $(NOISE).remove();
  const out = [];
  const seen = new Set();
  $('tr, li').each((_, row) => {
    if ($(row).find('tr, li').length) return; // 只取最內層的列
    const cells = $(row)
      .children('td, div, span, a, p')
      .map((__, c) => cleanText($(c).text()).replace(/\n+/g, ' '))
      .get()
      .filter(Boolean);
    const text = cleanText($(row).text()).replace(/\n+/g, ' ');
    if (text.length < 15) return;
    const date = findDates(cells.find((c) => /^\s*\d{2,4}[-/.]\d{1,2}[-/.]\d{1,2}\s*$/.test(c)) || '')[0]?.iso || null;
    if (!date) return;
    const title = cleanTitle(cells.find((c) => c.length >= 8 && !/^\d+$/.test(c)) || '');
    if (!title || seen.has(title)) return;
    seen.add(title);
    const u = new URL(pageUrl);
    u.hash = `row-${encodeURIComponent(title.slice(0, 40))}`;
    out.push({ url: u.href, title, date, text });
  });
  return out;
}

/** 列表頁的「下一頁」連結（javascript postback 無法跟隨時回傳 null） */
export function findNextPage(html, baseUrl) {
  const $ = load(html);
  let next = null;
  $('a[href]').each((_, a) => {
    if (next) return;
    const label = `${$(a).text()} ${$(a).attr('title') || ''} ${$(a).attr('aria-label') || ''}`.replace(/\s+/g, '');
    if (!/^(下一頁|下頁|次頁|Next|›|»)/i.test(label) && !/(下一頁|下頁|次頁)/.test($(a).attr('title') || '')) return;
    const url = absUrl($(a).attr('href'), baseUrl);
    if (url && url !== baseUrl) next = url;
  });
  return next;
}

/** 判斷文字中中文字比例，用來挑出內文主體 */
function cjkCount(s) {
  const m = s.match(/[一-鿿]/g);
  return m ? m.length : 0;
}

/**
 * 擷取頁面標題與內文主體文字。
 */
export function extractMain(html, baseUrl) {
  const $ = load(html);
  const pageTitle = cleanText($('title').first().text());
  const metaDesc = cleanText($('meta[name="description"]').attr('content') || '');
  $(NOISE).remove();
  $('nav,header,footer').remove();

  let best = null;
  let bestScore = 0;
  const bodyLen = cjkCount($('body').text()) || 1;
  $('article,main,section,div,td').each((_, el) => {
    const cls = `${$(el).attr('class') || ''} ${$(el).attr('id') || ''}`;
    if (NAV_HINT.test(cls)) return;
    const text = $(el).text();
    const total = cjkCount(text);
    if (total < 40) return;
    let linkText = 0;
    $(el).find('a').each((__, a) => (linkText += cjkCount($(a).text())));
    // 內文比例高、連結文字少者得分高；整頁容器（幾乎等於 body）扣分
    let score = total - linkText * 2.5;
    if (total > bodyLen * 0.92) score *= 0.5;
    if (/content|article|main|cp|detail|editor|text|news/i.test(cls)) score *= 1.15;
    if (score > bestScore) {
      bestScore = score;
      best = el;
    }
  });
  // 往下收斂到仍保有大部分分數的最深節點
  if (best) {
    for (;;) {
      let next = null;
      $(best).children('article,section,div,td,table,tbody,tr').each((_, c) => {
        const t = cjkCount($(c).text());
        let lt = 0;
        $(c).find('a').each((__, a) => (lt += cjkCount($(a).text())));
        if (t - lt * 2.5 >= bestScore * 0.85) next = c;
      });
      if (!next) break;
      best = next;
    }
  }
  const container = best ? $(best) : $('body');
  // 保留段落換行
  container.find('br').replaceWith('\n');
  container.find('p,li,tr,h1,h2,h3,h4,div').each((_, el) => {
    $(el).append('\n');
  });
  const text = cleanText(container.text()).replace(/\n{2,}/g, '\n');

  // 標題：h1/h2 中與 <title> 重疊者，否則 <title>
  let heading = '';
  $('h1,h2,h3,.title,.news-title,.cp-title').each((_, h) => {
    const t = cleanText($(h).text()).replace(/\n/g, ' ');
    if (!heading && t.length >= 6 && t.length <= 200 && cjkCount(t) >= 4) heading = t;
  });

  // 附件
  const attachments = [];
  const seen = new Set();
  $('a[href]').each((_, a) => {
    const href = $(a).attr('href') || '';
    const url = absUrl(href, baseUrl);
    if (!url || seen.has(url)) return;
    const label = cleanText(`${$(a).text()} ${$(a).attr('title') || ''}`).replace(/\n/g, ' ');
    const isFile =
      /\.(pdf|odt|docx|doc|ods|xlsx)(\?|$)/i.test(url) ||
      /(download|file_?id|fileid|getfile|attach|wHandNews_File|DownloadFile|Download\.ashx)/i.test(url) ||
      /\.(pdf|odt|docx)\b/i.test(label);
    if (!isFile) return;
    seen.add(url);
    attachments.push({ url, label: label.slice(0, 120) });
  });

  return { pageTitle, heading, metaDesc, text, attachments };
}
