import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { waitForEngine } from '../runtime/engine.mjs';

test('engine readiness retries refused connections until the engine starts', async () => {
  const server = createServer((socket) => socket.end());
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  const engine = new URL(`ws://127.0.0.1:${port}`);
  const starting = delay(50).then(() => new Promise((resolve) => server.listen(port, '127.0.0.1', resolve)));
  try {
    await waitForEngine(engine, { timeoutMs: 5000, pollIntervalMs: 10, connectTimeoutMs: 50 });
    assert.equal(server.listening, true, 'Readiness must wait until the engine starts listening');
  } finally {
    await starting;
    await new Promise((resolve) => server.close(resolve));
  }
});

test('engine readiness stops at its deadline when the engine never starts', async () => {
  await assert.rejects(waitForEngine(new URL('ws://127.0.0.1:1'), {
    timeoutMs: 30, pollIntervalMs: 5, connectTimeoutMs: 5,
  }), /Engine readiness deadline exceeded/);
});
