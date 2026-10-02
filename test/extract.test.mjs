import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractAmount, extractTarget, parseAmount, extractFields } from '../crawler/lib/extract.mjs';
import { classify, titleWorthFetching } from '../crawler/lib/classify.mjs';

test('金額解析', () => {
  assert.equal(parseAmount('1,500萬元'), 15000000);
  assert.equal(parseAmount('新臺幣3,000元'), 3000);
  assert.equal(parseAmount('2億元'), 200000000);
});

test('單一上限金額', () => {
  assert.equal(extractAmount('每案補助經費上限新臺幣2,000萬元。').text, '最高新臺幣 2,000 萬元');
  assert.equal(extractAmount('補助金額不超過總經費50%，並以新臺幣500萬元為上限。').text, '最高新臺幣 500 萬元');
});

test('多種級距：顯示最高並註明依類型不同，不只挑一個數字', () => {
  const r = extractAmount('契約用電容量達100瓩以上者，補助額度以500萬元為上限；達800瓩以上者，補助額度以1,500萬元為上限。');
  assert.equal(r.text, '最高新臺幣 1,500 萬元（依申請類型不同）');
  assert.equal(r.details.length, 2);
});

test('總經費、罰鍰等不是補助金額', () => {
  assert.equal(extractAmount('本計畫總經費新臺幣3億元。').text, null);
  assert.equal(extractAmount('沒有任何金額').text, null);
});

test('補助對象：原文擷取、忽略目錄點線', () => {
  assert.equal(extractTarget('三、補助對象:契約用電容量超過一百瓩，且依法設立登記之法人。\n四、申請應備文件'), '契約用電容量超過一百瓩，且依法設立登記之法人。');
  assert.equal(extractTarget('補助對象..........................3'), null);
  assert.equal(extractTarget('沒有標籤'), null);
});

test('官方未寫的欄位維持 null（前台顯示官方未明載）', () => {
  const f = extractFields({ title: '公告某補助', text: '詳細內容請見附件。' });
  assert.equal(f.apply_start, null);
  assert.equal(f.apply_end, null);
  assert.equal(f.amount_text, null);
  assert.equal(f.target, null);
});

test('節能補助判定：看內容不是只看名稱', () => {
  // 名稱沒有「節能」但內容是高效率設備汰換
  assert.ok(classify({ title: '公告115年度動力設備補助受理申請', text: '補助購置高效率馬達、空壓機，提升能源效率，汰換老舊設備。' }).isSubsidy);
  // 純太陽光電
  assert.ok(!classify({ title: '公告115年度太陽光電設置補助', text: '補助設置太陽光電發電設備。' }).isSubsidy);
  // 純儲能
  assert.ok(!classify({ title: '經濟部推動產業儲能補助', text: '補助儲能系統建置。' }).isSubsidy);
  // 太陽光電＋實質節能 → 收錄
  assert.ok(classify({ title: '公告節能及太陽光電設備補助', text: '補助汰換高效率空調、LED 照明及設置太陽光電。' }).isSubsidy);
  // 真實誤判案例：公共安全設施補助只提到空調、設備汰換，沒有節能 → 不收錄
  assert.ok(!classify({ title: '公告115年度「精神復健機構改善公共安全設施設備補助計畫」申請作業須知', text: '補助項目：消防設備、空調設備汰換、緊急發電機馬達。' }).isSubsidy);
  // 非補助公告
  assert.ok(!classify({ title: '節能標竿獎頒獎典禮', text: '節能 節電' }).isSubsidy);
  assert.ok(!titleWorthFetching('經濟部能源署技士職缺錄取公告'));
  assert.ok(!titleWorthFetching('2025綠建築在臺灣作品專輯徵求代售單位網頁公告'));
  assert.ok(titleWorthFetching('公告115年度「節能服務業獎勵」第二梯次受理申請期間'));
});
