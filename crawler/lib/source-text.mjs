// 讀取官方公告全文（頁面＋說明文件附件），供 AI 整理卡片欄位使用。
import { fetchPage, fetchResource } from './fetcher.mjs';
import { extractMain } from './html.mjs';
import { documentText, filenameFromDisposition } from './docs.mjs';

export async function attachmentsText(attachments, max = 3) {
  let text = '';
  for (const a of attachments.slice(0, max)) {
    try {
      const r = await fetchResource(a.url, { binary: true });
      const name = filenameFromDisposition(r.disposition) || a.label;
      text += (await documentText(r.bytes, { contentType: r.contentType, name })) + '\n';
    } catch {
      /* 附件讀取失敗不影響主要內容 */
    }
  }
  return text;
}

// 身分揭露表、切結書、申請表等表單不含補助內容，不交給 AI
export const AI_ATTACH_SKIP = /揭露|切結|檢核表|申請表|報名表|範例|海報|簡報|議程|名單/;

/** 公告頁面＋說明文件附件全文 */
export async function pageWithDocsText(url) {
  if (/\.(pdf|odt|docx?)(\?|$)/i.test(url)) {
    const r = await fetchResource(url, { binary: true });
    return documentText(r.bytes, { contentType: r.contentType, name: filenameFromDisposition(r.disposition) || url });
  }
  const page = await fetchPage(url);
  const main = extractMain(page.text, page.url);
  const docs = main.attachments.filter((a) => !AI_ATTACH_SKIP.test(a.label || ''));
  return `${main.text}\n${await attachmentsText(docs)}`;
}
