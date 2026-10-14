import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchWhenServiceReady } from './fixtures/service-client.mjs';

const endpoint = 'http://service.test/status';
const refused = () => new TypeError('fetch failed', { cause: { code: 'ECONNREFUSED' } });
test('Service readiness retries refused connections and returns the first HTTP result unchanged', async () => {
  let calls = 0;
  const response = new Response('', { status: 401 });
  const result = await fetchWhenServiceReady(endpoint, {}, { delayMs: 0, fetchImpl: async () => {
    if (++calls < 3) throw refused();
    return response;
  } });
  assert.equal(result, response);
  assert.equal(result.status, 401);
  assert.equal(calls, 3);
});
test('Service readiness fails after its retry budget', async () => {
  let calls = 0;
  await assert.rejects(fetchWhenServiceReady(endpoint, {}, { attempts: 3, delayMs: 0,
    fetchImpl: async () => { calls++; throw refused(); },
  }), (error) => error.cause.code === 'ECONNREFUSED');
  assert.equal(calls, 3);
});
test('Service readiness never retries unrelated failures', async () => {
  let calls = 0;
  const error = new TypeError('DNS failed', { cause: { code: 'ENOTFOUND' } });
  await assert.rejects(fetchWhenServiceReady(endpoint, {}, {
    fetchImpl: async () => { calls++; throw error; },
  }), (actual) => actual === error);
  assert.equal(calls, 1);
});
