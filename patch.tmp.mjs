import fs from 'node:fs';
const p = 'crawler/lib/dates.mjs';
const lines = fs.readFileSync(p, 'utf8').split('\n');
// line 17 (index 16): ".replace(/\r/g, '');"
if (!lines[16].includes(".replace(/\r/g, '');")) throw new Error('unexpected line 17: ' + lines[16]);
lines[16] = "    .replace(/\r/g, '')\n    // 國字年份（一百十五年度 → 115年度），只轉換後面接「年」的數字\n    .replace(/(一百[零一二三四五六七八九十]{0,3})(?=\s*年)/g, (m) => String(cnNumber(m) ?? m));";
let s = lines.join('\n');
s = s.replace("export function normalizeText(s) {", `/** 國字數字轉阿拉伯數字（支援一百至一百九十九，例：一百十五、一百一十五、一百零五） */
export function cnNumber(s) {
  const D = { 零: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  const m = /^一百(零)?(?:([一二三四五六七八九]?)十)?([一二三四五六七八九])?$/.exec(s);
  if (!m) return null;
  const tens = /十/.test(s) ? (m[2] ? D[m[2]] : 1) : 0;
  return 100 + tens * 10 + (m[3] ? D[m[3]] : 0);
}

export function normalizeText(s) {`);
s = s.replace("止$|日s*[)）]?s*前/", "止$|日\s*[)）]?\s*前/");
fs.writeFileSync(p, s);
console.log('patched');
