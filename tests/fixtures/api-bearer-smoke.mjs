import assert from 'node:assert/strict';
// The integration fixture ConfigMap mounts this module at /fixture.
import { fetchWhenServiceReady } from '/fixture/service-client.mjs';

const endpoint = 'http://memory.agentmemory.svc.cluster.local:3111/agentmemory/status';
assert.equal((await fetchWhenServiceReady(endpoint)).status, 401);
const response = await fetch(endpoint, {
  headers: { Authorization: `Bearer ${process.env.AGENTMEMORY_SECRET}` }, signal: AbortSignal.timeout(30000),
});
assert.equal(response.status, 200, await response.text());
console.log('API Service: missing credentials denied and standard memory bearer accepted from a separate client');
