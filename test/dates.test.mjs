import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseDate, findDates, extractPeriod, detectStatusFlag, detectUntilQuota, extractAnnounceDate, toAdYear,
} from '../crawler/lib/dates.mjs';

test('民國日期轉西元', () => {
  assert.equal(parseDate('115年9月11日'), '2026-09-11');
  assert.equal(parseDate('中華民國115年09月01日'), '2026-09-01');
  assert.equal(parseDate('(115-09-30) 離岸風電'), '2026-09-30');
  assert.equal(parseDate('115/9/1'), '2026-09-01');
  assert.equal(parseDate('115.12.31'), '2026-12-31');
  assert.equal(parseDate('１１５年１０月１日'), '2026-10-01');
  assert.equal(parseDate('116年1月1日'), '2027-01-01');
  assert.equal(toAdYear('99'), 2010);
});

test('西元日期', () => {
  assert.equal(parseDate('2026年9月11日'), '2026-09-11');
  assert.equal(parseDate('2026/09/11'), '2026-09-11');
  assert.equal(parseDate('2026-9-1'), '2026-09-01');
});

test('不合法日期不採用', () => {
  assert.equal(parseDate('115年2月30日'), null);
  assert.equal(parseDate('電話 02-2775-7777'), null);
  assert.equal(parseDate('版本 1.2.3'), null);
});

test('申請期間：起訖', () => {
  const p = extractPeriod('一、申請期間：自115年3月2日起至115年10月30日下午5時止。');
  assert.equal(p.start, '2026-03-02');
  assert.equal(p.end, '2026-10-30');
  assert.equal(p.endTime, '17:00');
});

test('申請期間：只有截止日、無時間', () => {
  const p = extractPeriod('受理申請截止日期：115年11月14日');
  assert.equal(p.start, null);
  assert.equal(p.end, '2026-11-14');
  assert.equal(p.endTime, null);
});

test('申請期間：即日起至', () => {
  const p = extractPeriod('本計畫即日起至115年12月15日止受理申請', { announceDate: '2026-09-11' });
  assert.equal(p.start, '2026-09-11');
  assert.equal(p.end, '2026-12-15');
  assert.ok(p.fromToday);
});

test('申請期間：結束日只有月日，沿用同句年份', () => {
  const p = extractPeriod('受理期間：115年9月15日至10月31日止');
  assert.equal(p.start, '2026-09-15');
  assert.equal(p.end, '2026-10-31');
});

test('申請期間：西元與波浪號', () => {
  const p = extractPeriod('收件期間：2026/04/01～2026/06/30');
  assert.equal(p.start, '2026-04-01');
  assert.equal(p.end, '2026-06-30');
});

test('額滿為止與狀態旗標', () => {
  assert.ok(detectUntilQuota('受理至經費用罄為止'));
  assert.ok(detectUntilQuota('申請至額滿為止'));
  assert.equal(detectStatusFlag('受理至經費用罄為止'), null);
  assert.equal(detectStatusFlag('本年度補助經費已用罄，即日起停止受理'), 'budget_exhausted');
  assert.equal(detectStatusFlag('本計畫已額滿'), 'quota_full');
  assert.equal(detectStatusFlag('因申請踴躍提前截止收件'), 'closed_early');
  assert.equal(detectStatusFlag('一般內容'), null);
});

test('真實案例：能源署節能服務業獎勵第二梯次公告', () => {
  const text = '公告事項：一、受理申請期間：自即日起至中華民國115年11月16日17時止。期間屆滿前，如獎勵經費即將用罄，本署得公告提前截止受理申請。二、受理申請處所：(一)線上申請網址。三、節電專案有效期間：自115年1月1日起至115年11月16日止。';
  const p = extractPeriod(text, { announceDate: '2026-09-11' });
  assert.equal(p.start, '2026-09-11');
  assert.equal(p.end, '2026-11-16');
  assert.equal(p.endTime, '17:00');
  assert.equal(detectStatusFlag(text), null, '假設語氣不可判為提前截止');
  assert.equal(detectStatusFlag('本署公告自115年10月1日起提前截止受理申請'), 'closed_early');
});

test('真實案例：標題中的「受理申請期間」不可誤抓發文日期', () => {
  const text = [
    '公告116年度「廢熱與廢冷回收技術示範應用專案」第2梯次受理申請補助期間',
    '發布日期:115-08-31 下午 02:23',
    '發文日期:中華民國115年8月21日',
    '主 旨:公告116年度「廢熱與廢冷回收技術示範應用專案」第2梯次受理申請補助期間。',
    '一、受理申請期間:自即日起至115年11月2日下午5時30分止(以指定送達地點收受申請文件之時間為準)。',
  ].join('\n');
  const p = extractPeriod(text, { announceDate: '2026-08-31' });
  assert.equal(p.start, '2026-08-31');
  assert.equal(p.end, '2026-11-02');
  assert.equal(p.endTime, '17:30');
});

test('沒有日期時不推測', () => {
  const p = extractPeriod('申請方式請洽主辦單位');
  assert.equal(p.start, null);
  assert.equal(p.end, null);
});

test('公告日期', () => {
  assert.equal(extractAnnounceDate('發布日期：115-09-11 更新'), '2026-09-11');
  assert.equal(extractAnnounceDate('公告日期: 2026/08/01'), '2026-08-01');
  assert.equal(extractAnnounceDate('申請日期：115年1月1日'), null);
});

test('findDates 去重疊並依位置排序', () => {
  const d = findDates('自115年3月2日起至115年10月30日止');
  assert.deepEqual(d.map((x) => x.iso), ['2026-03-02', '2026-10-30']);
});
