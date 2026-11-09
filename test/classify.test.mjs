import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify, energySignals, titleWorthFetching } from '../crawler/lib/classify.mjs';

test('真實誤判：道路建設新聞稿只順帶提到節能，不收錄', () => {
  const title = '中央補助2.28億元 宜蘭市第11號道路今通車 分流市區車潮 打通交通瓶頸';
  const text = '同時設置LED路燈，兼顧道路通行、排水及周邊環境需求。工程也採用瀝青刨除再生材料，落實資源再利用及綠色節能理念。';
  assert.equal(titleWorthFetching(title), false, '通車新聞不需要抓內文');
  // 即使標題不含「通車」，只提到一次節能也不足以收錄
  assert.equal(classify({ title: '中央補助2.28億元開闢宜蘭市第11號道路', text }).isSubsidy, false);
});

test('報導補助成果的新聞稿：沒有申請相關字眼，不收錄', () => {
  const text = '工程採用節能燈具與節能空調，落實節能理念。';
  assert.equal(classify({ title: '中央補助地方公共工程成果', text }).isSubsidy, false);
});

test('真實誤判：「電動機車」不是「電動機」（馬達）', () => {
  assert.deepEqual(energySignals('電動機車'), []);
  assert.ok(energySignals('高效率電動機').includes('馬達動力'));
  const text = '補助購買電動機車，含馬達與電池規格，汰舊換新另有加碼，須符合能源效率基準。申請方式如附件。';
  assert.equal(classify({ title: '經濟部提升電動機車產業補助實施要點', text }).isSubsidy, false);
  assert.equal(classify({ title: '電動機車汰舊換新補助', text }).isSubsidy, false);
});

test('真實誤判：核定名單與研究計畫不是可申請的節能補助', () => {
  const list = '116年度「節能績效保證專案示範推廣補助計畫」受補助單位與補助金額上限';
  assert.equal(titleWorthFetching(list), false);
  assert.equal(classify({ title: list, text: list }).isSubsidy, false);
  const research = '114年度「補助溫室氣體減量管理及氣候變遷調適研究發展計畫」';
  assert.equal(titleWorthFetching(research), false);
  assert.equal(classify({ title: research, text: '受理申請。節約能源、提升能源效率、製程節能。' }).isSubsidy, false);
  // 「研究所」是機關名稱，不可被研究計畫規則擋下
  assert.ok(classify({ title: '內政部建築研究所公告建築能效改善補助計畫', text: '' }).isSubsidy);
});

test('真正的節能補助仍要收錄', () => {
  // 標題沒有節能字眼，靠內文判定
  assert.ok(
    classify({
      title: '115 年度 - 冷卻行動創新示範補助計畫（修正版）',
      text: '補助汰換高能源效率冰水主機，導入能源管理系統，達成節能目標。受理申請期間如下。',
    }).isSubsidy,
  );
  // 標題只有設備類訊號，內文有核心節能詞
  assert.ok(classify({ title: '115年度設備汰換補助相關規定公告', text: '補助店家汰換節能設備。' }).isSubsidy);
  assert.ok(classify({ title: '115年度動力與公用設備補助受理申請', text: '補助已登錄能源效率之電動機。' }).isSubsidy);
  // 標題有核心節能詞：內文簡短也收錄（含「規範完工日」不可被新聞規則擋下）
  assert.ok(classify({ title: '公告115年度節能服務業獎勵受理申請期間與規範完工日', text: '' }).isSubsidy);
  assert.ok(titleWorthFetching('公告115年度節能服務業獎勵受理申請期間與規範完工日'));
});
