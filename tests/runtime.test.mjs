import { test } from 'node:test';
import assert from 'node:assert/strict';

test('paired SDK imports with the patched telemetry helper', async () => {
  const sdk = await import('iii-sdk');
  assert.equal(typeof sdk.registerWorker, 'function');
});
