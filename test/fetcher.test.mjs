import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRobots, robotsAllows } from '../crawler/lib/fetcher.mjs';

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
