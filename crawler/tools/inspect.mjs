// 開發用：檢視某網址被解析成什麼。
// node crawler/tools/inspect.mjs list <url>   列表頁連結
// node crawler/tools/inspect.mjs page <url>   內文、附件
import { fetchResource } from '../lib/fetcher.mjs';
import { extractListLinks, extractMain } from '../lib/html.mjs';

const [mode, url] = process.argv.slice(2);
const res = await fetchResource(url, { respectRobots: false });
if (mode === 'list') {
  for (const l of extractListLinks(res.text, res.url)) console.log(`${l.date || '----------'} | ${l.title.slice(0, 70)} | ${l.url}`);
} else {
  const m = extractMain(res.text, res.url);
  console.log('TITLE:', m.pageTitle, '\nHEADING:', m.heading, '\n---\n' + m.text.slice(0, Number(process.argv[4] || 3000)));
  console.log('--- attachments');
  for (const a of m.attachments) console.log(a.label, '|', a.url);
}
