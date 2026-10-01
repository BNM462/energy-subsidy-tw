// 自動探索：從機關首頁找出「最新消息／公告／補助專區」等列表頁。
import * as cheerio from 'cheerio';
import { normalizeText } from './dates.mjs';

const LIST_TEXT =
  /最新消息|新聞稿|新聞發布|即時新聞|本部新聞|本署新聞|本局新聞|本會新聞|新聞與公告|公告|公布欄|布告欄|補助|獎勵|獎補助|徵件|徵求|計畫申請|業務資訊|活動訊息|消息專區|訊息公告/;
const SKIP_TEXT = /採購|招標|徵才|人事|徵人|英文|English|影音|相簿|照片|出版品|統計|意見信箱|網站導覽|隱私|資安|無障礙|RSS|下載|問答|FAQ|聯絡|地圖|首長|組織|預算|決算|會計|法令|法規查詢|訴願|國家賠償|陳情|檔案應用|開放資料|政府資訊公開|招商|性別|廉政|新聞澄清|即時新聞澄清|地方新聞/;

/** 同機關網域（含子網域） */
export function sameAgency(url, homepage) {
  try {
    const a = new URL(url).hostname.replace(/^www\./, '');
    const b = new URL(homepage).hostname.replace(/^www\./, '');
    return a === b || a.endsWith('.' + b) || b.endsWith('.' + a);
  } catch {
    return false;
  }
}

// 行政院規定各機關設置的「補助業務揭露公開專區」→「補助資訊公告專區」，是最重要的入口
export const SUBSIDY_ZONE_TEXT = /補助資訊公告|補助公告專區|獎補助資訊|補助業務揭露|補助專區|獎補助專區|補助計畫公告|補助資訊專區/;

export function discoverListPages(html, baseUrl, { max = 6 } = {}) {
  const $ = cheerio.load(html);
  $('script,style,noscript').remove();
  const found = new Map();
  $('a[href]').each((_, a) => {
    const href = $(a).attr('href');
    if (!href || /^(javascript:|mailto:|#)/i.test(href)) return;
    let url;
    try {
      const u = new URL(href, baseUrl);
      u.hash = '';
      url = u.href;
    } catch {
      return;
    }
    if (!/^https?:/.test(url) || !sameAgency(url, baseUrl)) return;
    if (/\.(pdf|odt|docx?|xlsx?|jpg|png|zip)(\?|$)/i.test(url)) return;
    const text = normalizeText(`${$(a).text()} ${$(a).attr('title') || ''}`).replace(/\s+/g, ' ').trim();
    if (!text || text.length > 30) return;
    if (!(LIST_TEXT.test(text) || SUBSIDY_ZONE_TEXT.test(text)) || SKIP_TEXT.test(text)) return;
    if (/核定|名單|結果/.test(text)) return;
    // 「更多」連結通常就是列表頁
    const score =
      (SUBSIDY_ZONE_TEXT.test(text) ? 5 : 0) +
      (/補助|獎勵|獎補助|徵件|徵求/.test(text) ? 3 : 0) +
      (/公告|公布欄|布告欄/.test(text) ? 2 : 0) +
      (/最新消息|新聞/.test(text) ? 1 : 0);
    const prev = found.get(url);
    if (!prev || prev.score < score) found.set(url, { url, text, score });
  });
  return [...found.values()].sort((a, b) => b.score - a.score).slice(0, max);
}
