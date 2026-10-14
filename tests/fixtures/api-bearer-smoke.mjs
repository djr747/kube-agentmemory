import assert from 'node:assert/strict';
// The integration fixture ConfigMap mounts this module at /fixture.
import { fetchWhenServiceReady } from '/fixture/service-client.mjs';

const endpoints = [
  `http://memory.agentmemory.svc.cluster.local:${process.env.API_SERVICE_PORT || 3111}/agentmemory/status`,
  'http://memory-headless.agentmemory.svc.cluster.local:3111/agentmemory/status',
];
await Promise.all(endpoints.map(async (endpoint) => {
  assert.equal((await fetchWhenServiceReady(endpoint)).status, 401);
  const response = await fetch(endpoint, {
    headers: { Authorization: `Bearer ${process.env.AGENTMEMORY_SECRET}` }, signal: AbortSignal.timeout(30000),
  });
  assert.equal(response.status, 200, await response.text());
}));
console.log('ClusterIP and headless API: missing credentials denied and standard memory bearer accepted');
