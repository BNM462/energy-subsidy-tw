// 官方附件（PDF / ODT / DOCX）文字擷取。
import { unzipSync, strFromU8 } from 'fflate';

let pdfMod = null;

function sniff(bytes, contentType = '', name = '') {
  const head = String.fromCharCode(...bytes.slice(0, 5));
  if (head.startsWith('%PDF')) return 'pdf';
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
    if (/\.odt|opendocument\.text/i.test(name + contentType)) return 'odt';
    if (/\.docx|wordprocessingml/i.test(name + contentType)) return 'docx';
    return 'zip';
  }
  return null;
}

function xmlToText(xml) {
  return xml
    .replace(/<\/(text:p|text:h|w:p)>/g, '\n')
    .replace(/<(text:tab|w:tab)\/?>/g, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

/**
 * 回傳附件純文字；無法辨識或為掃描影像時回傳空字串。
 */
export async function documentText(bytes, { contentType = '', name = '' } = {}) {
  const kind = sniff(bytes, contentType, name);
  try {
    if (kind === 'pdf') {
      pdfMod ||= await import('unpdf');
      const pdf = await pdfMod.getDocumentProxy(new Uint8Array(bytes), { verbosity: 0 });
      const maxPages = Math.min(pdf.numPages, 30);
      const parts = [];
      for (let i = 1; i <= maxPages; i++) {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        parts.push(content.items.map((it) => it.str + (it.hasEOL ? '\n' : '')).join(''));
      }
      return parts.join('\n').slice(0, 60000);
    }
    if (kind === 'odt' || kind === 'docx' || kind === 'zip') {
      const files = unzipSync(bytes, { filter: (f) => f.name === 'content.xml' || f.name === 'word/document.xml' });
      const xml = files['content.xml'] || files['word/document.xml'];
      if (xml) return xmlToText(strFromU8(xml)).slice(0, 60000);
      if (kind !== 'zip') return '';
      // 一般壓縮檔（例：申請須知及報名表.zip）：讀取裡面的 PDF／Word／ODT
      const inner = unzipSync(bytes, { filter: (f) => /\.(pdf|docx|odt)$/i.test(f.name) && f.originalSize < 15 * 1024 * 1024 });
      const parts = [];
      for (const [name, data] of Object.entries(inner).slice(0, 5)) {
        parts.push(await documentText(data, { name }));
      }
      return parts.join('\n').slice(0, 60000);
    }
  } catch {
    return '';
  }
  return '';
}

/** 從 Content-Disposition 取檔名 */
export function filenameFromDisposition(disp) {
  const m = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disp || '');
  if (!m) return '';
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return m[1];
  }
}
