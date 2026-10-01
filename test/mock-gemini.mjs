// 本機測試用的 Gemini 模擬伺服器（不連線 Google、不需要真的 API Key）
// MOCK_MODE 檔案內容：ok（正常回答）或 429（模擬免費額度用完）
import http from 'node:http';
import { readFileSync } from 'node:fs';

const modeFile = new URL('./mock-mode.txt', import.meta.url);
const port = Number(process.argv[2] || 8799);

http
  .createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      let mode = 'ok';
      try {
        mode = readFileSync(modeFile, 'utf8').trim();
      } catch {}
      if (mode === '429') {
        res.writeHead(429, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ error: { code: 429, status: 'RESOURCE_EXHAUSTED' } }));
      }
      const data = JSON.parse(body || '{}');
      const ctx = data.contents?.[0]?.parts?.[0]?.text || '';
      const url = (/官方網址：(\S+)/.exec(ctx) || [])[1] || '';
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        candidates: [{ content: { parts: [{ text: `（模擬回答）可參考：${url}\n另一個捏造網址 https://fake.example.com/apply 不應出現。` }] } }],
      }));
    });
  })
  .listen(port, () => console.log('mock gemini on', port));
