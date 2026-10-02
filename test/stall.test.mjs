// 伺服器傳到一半停住時，爬蟲必須在逾時後回報錯誤，不可永遠卡住
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

test('傳輸中途停住：會逾時並回報錯誤', async () => {
  process.env.CRAWLER_TIMEOUT_MS = '400';
  const { fetchResource } = await import('../crawler/lib/fetcher.mjs?stall');
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html', 'content-length': '100000' });
    res.write('<html>只送一半'); // 之後不再送資料，也不關閉連線
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  const t = Date.now();
  await assert.rejects(fetchResource(`http://127.0.0.1:${port}/`, { respectRobots: false }), /逾時|中斷/);
  assert.ok(Date.now() - t < 10000);
  server.closeAllConnections();
  server.close();
});
