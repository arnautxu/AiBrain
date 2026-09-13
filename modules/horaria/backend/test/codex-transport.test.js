import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { requestCodex } from '../src/integration/providers.js';

test('private calculation accepts delayed headers and enforces its own deadline without following redirects', async () => {
  let mode = 'delayed';
  const server = createServer((req, res) => {
    assert.equal(req.headers['x-aibrain-authorization'], 'signed-test');
    req.resume();
    if (mode === 'redirect') { res.writeHead(302, { location: 'http://127.0.0.1:1/' }); res.end(); return; }
    const timer = setTimeout(() => res.end(JSON.stringify({ content: [{ type: 'text', text: '8' }] })), 60);
    res.on('close', () => clearTimeout(timer));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = new URL(`http://127.0.0.1:${server.address().port}/api/horaria-codex`);
  try {
    assert.equal((await requestCodex(url, 'signed-test', Buffer.from('{}'), 1000)).content[0].text, '8');
    await assert.rejects(requestCodex(url, 'signed-test', Buffer.from('{}'), 10), { name: 'AbortError' });
    mode = 'redirect';
    await assert.rejects(requestCodex(url, 'signed-test', Buffer.from('{}')), /302/);
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});
