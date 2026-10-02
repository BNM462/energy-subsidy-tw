// 以真實官方頁面片段建立的回歸測試
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractPeriod, detectStatusFlag } from '../crawler/lib/dates.mjs';
import { extractFields, extractDelegate, extractTarget } from '../crawler/lib/extract.mjs';
import { extractRowDocs } from '../crawler/lib/html.mjs';
import { normalizeName, similarity } from '../crawler/lib/dedupe.mjs';
import { titleWorthFetching } from '../crawler/lib/classify.mjs';

test('能源署節能績效保證專區：表格列（含手機版重複文字）', () => {
  const html = `<table><tr><th>序號</th><th>標題</th><th>主題</th><th>發布日期</th></tr>
  <tr><td>1</td><td>[重要]116年「節能績效保證專案示範推廣補助」申請資料下載</td>
  <td><div>申請資料如附件，116年「節能績效保證專案示範推廣補助」於115/8/17~115/9/16受理申請</div></td><td> 2026/08/17 </td>
  <td><div>標題: [重要]116年「節能績效保證專案示範推廣補助」申請資料下載 主題: 申請資料如附件，116年「節能績效保證專案示範推廣補助」於115/8/17~115/9/16受理申請 發布日期: 2026/08/17</div></td></tr></table>`;
  const rows = extractRowDocs(html, 'https://ea01.moeaea.gov.tw/e0409/Page/ProjectExecution.aspx');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].date, '2026-08-17');
  assert.match(rows[0].url, /ProjectExecution\.aspx#row-/);
  const f = extractFields({ title: rows[0].title, text: rows[0].text, listDate: rows[0].date });
  assert.equal(f.announce_date, '2026-08-17');
  assert.equal(f.apply_start, '2026-08-17');
  assert.equal(f.apply_end, '2026-09-16', '發布日期不可當成起訖日期');
});

test('商發署（中衛）系統節能專案公告', () => {
  const text = `2026-05-29 商業發展署
主旨:公告115年度「商業服務業系統節能專案補助」委託辦理單位、受理申請期間、補助結案期限及其展延條件及相關申請事宜。
三、 本案商業服務業系統節能專案補助之受理申請、審核等相關作業，委託財團法人中衛發展中心辦理，委託期間自中華民國(以下同)115年1月1日起至116年12月31日止。
四、 受理申請期間:自115年6月1日9時起至115年8月31日17時止。
五、 專案補助結案期限及其展延條件:受補助對象須於116年8月31日前，依補助要點規定完成專案補助結案。`;
  const f = extractFields({ title: '115年度節能專案補助相關規定公告', text, listDate: '2026-05-29' });
  assert.equal(f.apply_start, '2026-06-01');
  assert.equal(f.apply_end, '2026-08-31');
  assert.equal(f.apply_end_time, '17:00');
  assert.equal(f.target, null, '「受補助對象須於…」不是補助對象說明');
  assert.equal(f.delegate, '財團法人中衛發展中心');
  assert.equal(f.program_name, '商業服務業系統節能專案補助');
});

test('商發署設備汰換：「申請補助期間」優先於「委託期間」', () => {
  const p = extractPeriod('二、委託財團法人中衛發展中心辦理，委託期間自中華民國115年1月1日起至115年12月31日止。\n三、補助項目購買期間:自115年1月1日起至115年4月10日止。\n四、申請補助期間:自115年2月10日9時起至115年4月10日17時止。');
  assert.equal(p.start, '2026-02-10');
  assert.equal(p.end, '2026-04-10');
  assert.equal(p.endTime, '17:00');
});

test('商發署設備汰換懶人包：試算範例不是上限；依設備定額不挑單一數字', () => {
  const text = `補助內容有哪些
空調-每台以其額定冷氣能力每瓩(kW) 2500 元為補助上限。
電冰箱-每台補助上限3000元。
冷凍櫃-每台補助上限8000元。
案例試算
空調計算。單台補助計算:購入價為73700元乘上50%等於36850，因超過單台補助上限，以2500元乘上9.3kW等於23250元計。`;
  const f = extractFields({ title: '設備汰換補助懶人包', text });
  assert.ok(!/7\.37|73,?700/.test(f.amount_text));
  assert.equal(f.amount_text, '依設備項目定額補助（共 3 種上限，詳見詳細資訊）');
  assert.ok(similarity(normalizeName('設備汰換補助懶人包'), normalizeName('115年度設備汰換補助相關規定公告(已結束)', '商業服務業節能設備汰換補助')) >= 0.72);
});

test('冷卻行動：分類別不同截止日，自動取最晚截止並標示依類別不同', () => {
  const text = '補助法令依據:依據「溫室氣體減量技術及氣候變遷調適補助辦法」辦理\n一、受理申請期間:\n(一)第一類及第二類申請單位即日起至115年10月15日。\n(二)第三類申請單位即日起至115年11月30日。\n二、補助項目:本計畫補助類型';
  const p = extractPeriod(text, { announceDate: '2026-09-08' });
  assert.equal(p.start, '2026-09-08');
  assert.equal(p.end, '2026-11-30');
  assert.ok(p.varies);
  assert.match(p.rawText, /第一類及第二類申請單位即日起至115年10月15日；第三類申請單位即日起至115年11月30日/);
});

test('動力與公用設備：「公告日起至」與公文日期', () => {
  const text = '115年度「動力與公用設備補助」委託辦理單位\n經濟部能源署 公告\n中華民國115年2月6日\n能節字第11504000910號\n二、 補助購買期間:自115年1月1日起至115年12月31日止。\n三、 受理申請期間:公告日起至116年1月15日止。補助購買期間屆滿前，如補助經費即將用罄，得於網站公告終止補助。';
  const f = extractFields({ title: '115年度「動力與公用設備補助」委託辦理單位、補助購買期間、受理申請期間及相關申請事宜', text });
  assert.equal(f.announce_date, '2026-02-06');
  assert.equal(f.apply_start, '2026-02-06');
  assert.equal(f.apply_end, '2027-01-15', '不可誤用「補助購買期間」');
  assert.equal(f.status_flag, null, '「如補助經費即將用罄」是假設語氣');
});

test('經費用罄：只有「已經發生」才標示，規定與假設語氣不算', () => {
  assert.equal(detectStatusFlag('補助購買期間屆滿前，如補助經費即將用罄，得於「動力與公用設備補助」網站(https://www.mdss.org.tw)公告終止補助及提前截止受理申請補助。'), null);
  assert.equal(detectStatusFlag('預算經費用罄時，能源署得公告提前終止補助。'), null);
  assert.equal(detectStatusFlag('依審查結果擇優給予補助至補助經費用罄為原則。'), null);
  assert.equal(detectStatusFlag('因補助經費已全數用罄，「動力與公用設備補助申請系統」將於今日中午停止受理。'), 'budget_exhausted');
  // 法規本文不設定結束狀態
  assert.equal(extractFields({ title: '住宅家電汰舊換新節能補助作業要點', text: '補助經費用罄者，本部應公告提前截止受理。' }).status_flag, null);
});

test('執行期程在上一行：不是申請期間', () => {
  assert.equal(extractPeriod('執行期程\n自輔導計畫通過申請日起至115年12月31日止。').end, null);
});

test('ISO 50001：「輔導期程」不是申請期間', () => {
  const p = extractPeriod('六、輔導期程與內容\n(一)輔導期程自輔導計畫通過申請日起至115年12月31日止。');
  assert.equal(p.end, null);
});

test('受託執行單位與補助對象', () => {
  assert.equal(extractDelegate('委託財團法人工業技術研究院辦理'), '財團法人工業技術研究院');
  assert.equal(extractDelegate('無委託'), null);
  assert.equal(extractTarget('補助對象\n依法設立登記之法人'), '依法設立登記之法人');
});

test('懶人包、計畫頁可併入正式公告；試算與申請入口不是補助', () => {
  assert.ok(similarity(normalizeName('系統節能專案補助申請懶人包'), normalizeName('115年度節能專案補助相關規定公告', '商業服務業系統節能專案補助')) >= 0.72);
  assert.ok(!titleWorthFetching('產品補助試算'));
  assert.ok(!titleWorthFetching('立即申請設備汰換補助'));
});
