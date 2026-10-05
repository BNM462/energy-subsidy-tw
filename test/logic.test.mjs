import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeStatus, isNew, hotInfo, daysLeft, sortSubsidies, taipeiDate, taipeiYear, formatDateTime, periodText, deadlineMs,
} from '../public/js/logic.js';

// 以台灣時間建立時間點
const tw = (s) => Date.parse(`${s}+08:00`);

test('伺服器為 UTC 時仍以台灣日期判斷', () => {
  // UTC 2026-09-30 16:30 = 台灣 2026-10-01 00:30
  const now = Date.parse('2026-09-30T16:30:00Z');
  assert.equal(taipeiDate(now), '2026-10-01');
  assert.equal(formatDateTime(now), '2026/10/01 00:30:00');
});

test('跨年度切換', () => {
  assert.equal(taipeiYear(tw('2026-12-31T23:59:59')), 2026);
  assert.equal(taipeiYear(tw('2027-01-01T00:00:00')), 2027);
  // UTC 仍是 12/31，但台灣已是新年
  assert.equal(taipeiYear(Date.parse('2026-12-31T16:00:00Z')), 2027);
});

test('狀態：申請中／尚未開始／已截止', () => {
  const now = tw('2026-10-01T12:00:00');
  assert.equal(computeStatus({ apply_start: '2026-09-01', apply_end: '2026-10-31' }, now).key, 'open');
  assert.equal(computeStatus({ apply_start: '2026-10-02', apply_end: '2026-10-31' }, now).key, 'upcoming');
  assert.equal(computeStatus({ apply_start: '2026-08-01', apply_end: '2026-09-30' }, now).key, 'closed');
});

test('截止日沒寫時間：當天 23:59:59 前仍有效', () => {
  const sub = { apply_start: '2026-09-01', apply_end: '2026-10-01' };
  assert.equal(computeStatus(sub, tw('2026-10-01T23:59:58')).key, 'open');
  assert.equal(computeStatus(sub, tw('2026-10-02T00:00:00')).key, 'closed');
});

test('截止日有寫時間：依該時間', () => {
  const sub = { apply_start: '2026-09-01', apply_end: '2026-10-01', apply_end_time: '17:00' };
  assert.equal(computeStatus(sub, tw('2026-10-01T16:59:00')).key, 'open');
  assert.equal(computeStatus(sub, tw('2026-10-01T17:00:01')).key, 'closed');
  assert.equal(deadlineMs('2026-10-01', '17:00'), tw('2026-10-01T17:00:00'));
});

test('官方額滿／經費用罄優先於日期', () => {
  const now = tw('2026-10-01T12:00:00');
  const s = computeStatus({ apply_start: '2026-09-01', apply_end: '2026-12-31', status_flag: 'budget_exhausted' }, now);
  assert.equal(s.key, 'closed');
  assert.equal(s.reason, '經費用罄');
  assert.equal(computeStatus({ apply_end: '2026-12-31', status_flag: 'quota_full' }, now).reason, '已額滿');
});

test('沒有任何期程：不猜測狀態', () => {
  assert.equal(computeStatus({}, tw('2026-10-01T12:00:00')).key, 'unknown');
});

test('NEW：公告 7 天內', () => {
  const now = tw('2026-10-01T09:00:00');
  assert.ok(isNew({ announce_date: '2026-10-01' }, now));
  assert.ok(isNew({ announce_date: '2026-09-24' }, now));
  assert.ok(!isNew({ announce_date: '2026-09-23' }, now));
  assert.ok(!isNew({ announce_date: null }, now));
});

test('🔥 即將截止：剩 7 天、3 天、今天', () => {
  const sub = { apply_start: '2026-09-01', apply_end: '2026-10-08' };
  assert.deepEqual(hotInfo(sub, tw('2026-10-01T10:00:00')), { daysLeft: 7, text: '剩餘 7 天' });
  assert.equal(hotInfo(sub, tw('2026-09-30T10:00:00')), null);
  assert.equal(hotInfo(sub, tw('2026-10-05T10:00:00')).text, '剩餘 3 天');
  assert.equal(hotInfo(sub, tw('2026-10-08T23:00:00')).text, '今天截止');
  assert.equal(hotInfo(sub, tw('2026-10-09T00:00:01')), null);
});

test('額滿為止或無截止日：不虛構剩餘天數', () => {
  const now = tw('2026-10-01T10:00:00');
  assert.equal(daysLeft({ apply_start: '2026-09-01', until_quota: true }, now), null);
  assert.equal(hotInfo({ apply_start: '2026-09-01' }, now), null);
  assert.equal(periodText({ apply_start: '2026-09-01', until_quota: true }), '2026/09/01 起（額滿為止）');
  assert.equal(periodText({}), '官方未明載');
});

test('尚未開始不顯示剩餘天數', () => {
  assert.equal(daysLeft({ apply_start: '2026-10-05', apply_end: '2026-10-06' }, tw('2026-10-01T10:00:00')), null);
});

test('排序規則', () => {
  const now = tw('2026-10-01T10:00:00');
  const list = [
    { id: 'closedOld', announce_date: '2026-03-01', apply_start: '2026-03-01', apply_end: '2026-05-01' },
    { id: 'closedRecent', announce_date: '2026-03-01', apply_start: '2026-03-01', apply_end: '2026-09-20' },
    { id: 'upcoming', announce_date: '2026-08-01', apply_start: '2026-11-01', apply_end: '2026-12-01' },
    { id: 'openFar', announce_date: '2026-05-01', apply_start: '2026-05-01', apply_end: '2026-12-31' },
    { id: 'openNear', announce_date: '2026-05-01', apply_start: '2026-05-01', apply_end: '2026-10-05' },
    { id: 'openNoEnd', announce_date: '2026-05-01', apply_start: '2026-05-01', until_quota: true },
    { id: 'newOlder', announce_date: '2026-09-26', apply_start: '2026-09-26', apply_end: '2026-12-31' },
    { id: 'newest', announce_date: '2026-09-30', apply_start: '2026-11-01', apply_end: '2026-12-31' },
    { id: 'unknown', announce_date: '2026-06-01' },
  ];
  const ids = sortSubsidies(list, now).map((s) => s.id);
  assert.deepEqual(ids, ['newest', 'newOlder', 'openNear', 'openFar', 'openNoEnd', 'upcoming', 'unknown', 'closedRecent', 'closedOld']);
});

test('梯次統一以標籤呈現：期間文字開頭的梯次移到標籤，暫定標在日期後', async () => {
  const { periodText, titleTags } = await import('../public/js/logic.js');
  const a = { title: '提升商業服務業營運效能強化韌性計畫', period_text: '第四梯 2026/10/01 ～ 10/30 17:00' };
  assert.equal(periodText(a), '2026/10/01 ～ 10/30 17:00');
  assert.deepEqual(titleTags(a), ['第四梯次']);
  const b = { title: '韌性計畫', period_text: '第三梯（暫定） 2026/11/02 ～ 11/30 17:00' };
  assert.equal(periodText(b), '2026/11/02 ～ 11/30 17:00（暫定）');
  assert.deepEqual(titleTags(b), ['第三梯次']);
  assert.deepEqual(titleTags({ title: '公告116年度「廢熱與廢冷回收技術示範應用專案」第2梯次受理申請補助期間' }), ['116年度', '第二梯次']);
});
