// 開發用：檢查每個來源首頁能否連線、自動探索到哪些列表頁、列表中有幾則今年的補助類標題。
// node crawler/tools/probe-sources.mjs [sourceId...]
import { readFileSync } from 'node:fs';
import { fetchResource, mapLimit } from '../lib/fetcher.mjs';
import { discoverListPages } from '../lib/discover.mjs';
import { extractListLinks } from '../lib/html.mjs';
import { titleWorthFetching } from '../lib/classify.mjs';

const { sources } = JSON.parse(readFileSync(new URL('../config/sources.json', import.meta.url)));
const only = process.argv.slice(2);
const year = new Date().getFullYear();

await mapLimit(sources.filter((s) => !only.length || only.includes(s.id)), 6, async (s) => {
  const lines = [];
  try {
    const home = await fetchResource(s.homepage);
    const lists = discoverListPages(home.text, home.url);
    const all = [...new Set([...(s.lists || []), ...lists.map((l) => l.url)])];
    lines.push(`✔ ${s.id} ${s.agency} → ${lists.length} 個列表頁`);
    for (const url of all) {
      try {
        const r = await fetchResource(url);
        const links = extractListLinks(r.text, r.url);
        const dated = links.filter((l) => l.date?.startsWith(String(year)));
        const cand = links.filter((l) => titleWorthFetching(l.title) && (!l.date || l.date >= `${year}-01-01`));
        lines.push(`   ${url.slice(0, 110)}  links=${links.length} 今年=${dated.length} 候選=${cand.length}`);
        for (const c of cand.slice(0, 6)) lines.push(`      · ${c.date || '無日期'} ${c.title.slice(0, 60)}`);
      } catch (e) {
        lines.push(`   ✖ ${url.slice(0, 110)} ${e.message}`);
      }
    }
  } catch (e) {
    lines.push(`✖ ${s.id} ${s.agency} 首頁失敗：${e.message}`);
  }
  console.log(lines.join('\n'));
});
