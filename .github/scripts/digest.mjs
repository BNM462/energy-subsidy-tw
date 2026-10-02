// 每兩週補助摘要：列出最近 14 天新增／異動的補助與即將截止的補助，以問題單形式寄信給網站擁有者抽查。
// 只讀取網站公開 API，不需要任何密鑰；不使用 AI。
import { execFileSync } from 'node:child_process';
import {
  computeStatus, displayTitle, periodText, sortSubsidies, taipeiDate, daysLeft,
} from '../../public/js/logic.js';

const LABEL = '定期摘要';
const DAYS = 14;
const gh = (...args) => execFileSync('gh', args, { encoding: 'utf8' }).trim();

// 排程每週一執行，偶數週才寄（手動執行時一律寄）
const now = Date.now();
const week = Math.floor((now / 86400000 + 3) / 7); // 以週一為一週開始的週數
if (process.env.FORCE !== '1' && week % 2 !== 0) {
  console.log('本週不寄送（每兩週一次）');
  process.exit(0);
}

const base = (process.env.API_BASE || '').replace(/\/$/, '');
const data = await (await fetch(`${base}/api/subsidies`)).json();
const subs = sortSubsidies(data.subsidies || [], now);
const since = now - DAYS * 86400000;
const recent = (iso) => iso && Date.parse(iso) >= since;

const line = (s) => {
  const st = computeStatus(s, now);
  return `| ${st.light} ${st.label} | [${displayTitle(s)}](${s.official_url}) | ${s.agency} | ${periodText(s)} |`;
};
const table = (list) =>
  list.length ? ['| 狀態 | 補助 | 主辦機關 | 申請期間 |', '|---|---|---|---|', ...list.map(line)].join('\n') : '（無）';

const added = subs.filter((s) => recent(s.first_seen_at));
const changed = subs.filter((s) => !recent(s.first_seen_at) && recent(s.updated_at));
const closing = subs.filter((s) => {
  const d = daysLeft(s, now);
  return d != null && d >= 0 && d <= DAYS;
});

const owner = process.env.GITHUB_REPOSITORY_OWNER;
const body = [
  `${owner ? `@${owner} ` : ''}這是每兩週的補助摘要（${taipeiDate(now)}），請花幾分鐘抽查資料是否正確。`,
  '',
  `網站目前共收錄 **${subs.length}** 筆：${data.year} 年公告，以及去年公告今年仍受理、常態辦理的補助。`,
  '',
  `### 🆕 最近 ${DAYS} 天新增（${added.length}）`,
  table(added),
  '',
  `### ✏️ 最近 ${DAYS} 天內容有異動（${changed.length}）`,
  table(changed),
  '',
  `### 🔥 未來 ${DAYS} 天內截止（${closing.length}）`,
  table(closing),
  '',
  '---',
  '抽查重點：日期、狀態是否與官方公告一致；有沒有你知道、但這裡沒有的補助。',
  '發現問題時，把補助名稱與官方網址交給 AI（Claude、Codex 等）修改設定檔即可。',
  `網站：${base}`,
].join('\n');

try {
  gh('label', 'create', LABEL, '--color', '0E8A16', '--description', '每兩週補助摘要');
} catch {
  /* 標籤已存在 */
}
// 關閉上一期摘要，避免堆積
const old = JSON.parse(gh('issue', 'list', '--label', LABEL, '--state', 'open', '--json', 'number'));
for (const o of old) gh('issue', 'close', String(o.number), '--comment', '已有新一期摘要。');
gh('issue', 'create', '--title', `📋 節能補助摘要（${taipeiDate(now)}）`, '--label', LABEL, '--body', body);
console.log(`已寄出摘要：新增 ${added.length}、異動 ${changed.length}、即將截止 ${closing.length}`);
