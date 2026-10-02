// 爬蟲異常通知：開立／更新／關閉 GitHub 問題單（GitHub 會自動寄 Email 給專案擁有者）。
// 為避免洗信：同一時間只會有一張問題單，且最多每 24 小時補充一次。
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const LABEL = '自動監測';
const TITLE = '⚠ 補助資料自動更新異常';

const gh = (...args) => execFileSync('gh', args, { encoding: 'utf8' }).trim();

let report = {};
try {
  report = JSON.parse(readFileSync('crawler/out/last-run.json', 'utf8'));
} catch {
  report = { fatal: '沒有產生執行結果' };
}
const crawlFailed = process.env.CRAWL_OUTCOME !== 'success';

// 單次失敗可能只是暫時性網路問題：連續兩次失敗才通知
let previousFailed = false;
if (crawlFailed) {
  try {
    const runs = JSON.parse(gh('run', 'list', '--workflow', 'crawl.yml', '--limit', '5', '--json', 'conclusion,status'));
    const done = runs.filter((r) => r.status === 'completed');
    previousFailed = done[0]?.conclusion === 'failure';
  } catch {
    previousFailed = false;
  }
}

const problems = [];
if (crawlFailed && previousFailed) problems.push(`- 爬蟲連續執行失敗：${report.fatal || '請查看執行紀錄'}`);
for (const w of report.program_warnings || []) problems.push(`- ${w}`);
for (const s of report.failing_sources || []) {
  problems.push(`- ${s.agency}：連續 ${s.consecutive_failures} 次（約 ${Math.round(s.consecutive_failures / 2)} 小時）無法讀取。${s.error || ''}`);
}

try {
  gh('label', 'create', LABEL, '--color', 'B60205', '--description', '爬蟲自動監測通知');
} catch {
  /* 標籤已存在 */
}

const open = JSON.parse(gh('issue', 'list', '--label', LABEL, '--state', 'open', '--json', 'number,updatedAt', '--limit', '1'));
const runUrl = process.env.RUN_URL;
// 「@帳號」提及：GitHub 對提及的通知預設會寄 Email，比「關注專案」可靠
const owner = process.env.GITHUB_REPOSITORY_OWNER;
const mention = owner ? `@${owner} ` : '';

// 手動測試通知（GitHub Actions 頁面勾選「test_notify」執行）
if (process.env.TEST_NOTIFY === '1') {
  const body = `${mention}這是測試通知：如果你在信箱收到這封信，代表網站異常時你也會收到通知。（測試時間 ${new Date().toISOString()}）`;
  const n = gh('issue', 'create', '--title', '✅ 通知測試', '--body', body);
  gh('issue', 'close', n.split('/').pop(), '--comment', '測試完成，自動關閉。');
  console.log('已送出測試通知');
  process.exit(0);
}

if (problems.length) {
  const body = [
    `${mention}自動檢查發現以下問題（其他來源與既有資料不受影響，網站仍正常運作）：`,
    '',
    ...problems,
    '',
    `執行紀錄：${runUrl}`,
    '',
    '常見原因：政府網站改版、暫時維修、或網址變更。可請 AI 協助檢查 `crawler/config/sources.json`。',
  ].join('\n');
  if (!open.length) {
    gh('issue', 'create', '--title', TITLE, '--label', LABEL, '--body', body);
    console.log('已開立問題單');
  } else if (Date.now() - Date.parse(open[0].updatedAt) > 24 * 3600e3) {
    gh('issue', 'comment', String(open[0].number), '--body', `問題仍持續：\n\n${body}`);
    console.log('已補充問題單');
  } else {
    console.log('問題單已存在，24 小時內不重複通知');
  }
} else if (open.length && !crawlFailed) {
  gh('issue', 'close', String(open[0].number), '--comment', `${mention}已恢復正常（${new Date().toISOString()}）。`);
  console.log('已關閉問題單');
} else {
  console.log('一切正常');
}
