import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRobots, robotsAllows, softRedirectTarget, isBotChallenge } from '../crawler/lib/fetcher.mjs';
import { findNextPage, extractListLinks, cleanTitle } from '../crawler/lib/html.mjs';

test('列表頁：下一頁、日期取自同列而非標題', () => {
  const html = `<ul>
    <li><a href="/n/1">公告115年度「節能補助」即日起至115年11月30日受理申請</a><span>2026-09-01</span></li>
    <li><a href="/n/2" title="移至115年度設備汰換補助">移至115年度設備汰換補助</a></li>
  </ul><a href="?page=2" title="下一頁">›</a>`;
  const links = extractListLinks(html, 'https://x.gov.tw/list');
  assert.equal(links[0].date, '2026-09-01');
  assert.equal(links[1].date, null, '標題中的截止日不可當成公告日期');
  assert.equal(links[1].title, '115年度設備汰換補助');
  assert.equal(findNextPage(html, 'https://x.gov.tw/list'), 'https://x.gov.tw/list?page=2');
  assert.equal(findNextPage('<a href="javascript:__doPostBack()">下一頁</a>', 'https://x.gov.tw/'), null);
  assert.equal(cleanTitle('開新分頁下載116年度須知.pdf'), '116年度須知');
  // 衛福部列表：連結文字結尾的「115-04-10」為發布日期
  const mohw = extractListLinks('<ul><li><a href="/cp-1.html">公告115年度某補助計畫申請作業須知115-04-10</a></li></ul>', 'https://www.mohw.gov.tw/lp-18-1.html');
  assert.equal(mohw[0].date, '2026-04-10');
});

test('轉址頁與機器人防護偵測', () => {
  assert.equal(softRedirectTarget(`<script>document.location.href='https://www.ey.gov.tw/Index';</script>`, 'https://www.ey.gov.tw/'), 'https://www.ey.gov.tw/Index');
  assert.equal(softRedirectTarget(`<meta http-equiv="refresh" content="0; url=https://www.vac.gov.tw/mp-1.html" />`, 'https://www.vac.gov.tw/'), 'https://www.vac.gov.tw/mp-1.html');
  assert.ok(isBotChallenge('<html><script src="/_Incapsula_Resource?x=1"></script>'));
});

test('robots.txt：Allow 與 Disallow 最長符合', () => {
  const r = parseRobots(`User-agent: *\nDisallow: /\nAllow: /$\nAllow: /index.php\nAllow: /*.html\n\nUser-Agent: W3C-checklink\nDisallow:`);
  assert.ok(robotsAllows(r, 'https://x.gov.tw/'));
  assert.ok(robotsAllows(r, 'https://x.gov.tw/index.php'));
  assert.ok(robotsAllows(r, 'https://x.gov.tw/news/a.html'));
  assert.ok(!robotsAllows(r, 'https://x.gov.tw/admin'));
});

test('robots.txt：只對其他機器人限制時不影響本站', () => {
  const r = parseRobots(`User-agent: Googlebot\nDisallow: /search\n\nUser-agent: BadBot\nDisallow: /`);
  assert.ok(robotsAllows(r, 'https://x.gov.tw/search?q=1'));
});

test('robots.txt：全站禁止', () => {
  const r = parseRobots(`User-agent: Googlebot\nDisallow: /tag\n\nUser-agent: *\nDisallow: /`);
  assert.ok(!robotsAllows(r, 'https://x.gov.tw/anything'));
});
