import { test } from 'node:test';
import assert from 'node:assert/strict';
import { displayTitle, titleTags, targetPoints, categoriesOf, periodText } from '../public/js/logic.js';
import { classifyTargetTypes, extractBrief } from '../crawler/lib/extract.mjs';

test('精簡名稱：取計畫名稱、去除年度與修正版', () => {
  assert.equal(displayTitle({ title: '公告受理第四梯次「提升商業服務業營運效能強化韌性計畫」整合型補助申請須知（115年10月）' }), '提升商業服務業營運效能強化韌性計畫');
  assert.equal(displayTitle({ title: '115 年度 - 冷卻行動創新示範補助計畫（修正版）' }), '冷卻行動創新示範補助計畫');
  assert.equal(displayTitle({ title: '115年度「住宅家電汰舊換新節能補助作業要點」委託辦理單位' }), '住宅家電汰舊換新節能補助');
  assert.equal(displayTitle({ title: '115年度節能專案補助相關規定公告', program_name: '商業服務業系統節能專案補助' }), '商業服務業系統節能專案補助');
  assert.equal(displayTitle({ title: 'x', display_title: '人工指定名稱' }), '人工指定名稱');
});

test('年度與梯次標籤', () => {
  assert.deepEqual(titleTags({ title: '公告116年度「廢熱與廢冷回收」第2梯次受理' }), ['116年度', '第二梯次']);
  assert.deepEqual(titleTags({ title: '公告受理第四梯次「提升…」（115年10月）' }), ['115年度', '第四梯次']);
});

test('補助對象條列：依（一）（二）拆分', () => {
  assert.deepEqual(targetPoints({ target: '（一）依法設立之法人。 （二）醫療機構。' }), ['依法設立之法人。', '醫療機構。']);
  assert.deepEqual(targetPoints({ target_points: ['人工條列'] }), ['人工條列']);
  assert.deepEqual(targetPoints({}), []);
});

test('補助對象 6 大類', () => {
  assert.deepEqual(classifyTargetTypes('依法設立登記之法人，包含醫院、學校、旅館、商業或辦公大樓、機關(構)、工廠、農產品經營者'), ['服務業', '工業', '機關學校', '醫院／長照', '農業']);
  assert.deepEqual(classifyTargetTypes('經主管機關核准設立之醫療機構'), ['醫院／長照'], '「主管機關」不算機關');
  assert.deepEqual(classifyTargetTypes('住宅家電汰舊換新節能補助'), ['民眾']);
  assert.deepEqual(categoriesOf({ target_types: ['旅宿業', '製造業／工廠'] }), ['服務業', '工業'], '舊分類自動對照');
});

test('補助重點：挑選說明補助內容的句子，略過依據與聯絡資訊', () => {
  assert.equal(
    extractBrief('一、為協助我國商業服務業因應國際經貿情勢變動，透過補助具數位化整合能力之企業整合至少3處場域，導入AI、AIoT與節能應用，以強化供應鏈協作。'),
    '補助具數位化整合能力之企業整合至少3處場域，導入AI、AIoT與節能應用。',
  );
  assert.equal(extractBrief('依 據:「節能服務業獎勵要點」第17點。\n聯絡窗口:陳技士，電話02-1234。'), null);
});

test('期間文字可人工指定（多類別不同截止日）', () => {
  assert.equal(periodText({ period_text: '2026/09/08 ～ 11/30（第一、二類至 10/15）', apply_end: '2026-11-30' }), '2026/09/08 ～ 11/30（第一、二類至 10/15）');
});
