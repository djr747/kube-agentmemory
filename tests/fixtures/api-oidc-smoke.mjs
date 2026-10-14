import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve4 } from 'node:dns/promises';
// The integration fixture ConfigMap mounts this module at /fixture.
import { fetchWhenServiceReady } from '/fixture/service-client.mjs';

const tokens = await (await fetch('http://127.0.0.1:8080/test-tokens')).json();
const memorySecret = process.env.AGENTMEMORY_SECRET || readFileSync(process.env.AGENTMEMORY_SECRET_FILE, 'utf8').trim();
const endpoints = [
  `http://memory.agentmemory.svc.cluster.local:${process.env.API_SERVICE_PORT || 3111}/agentmemory/status`,
  'http://memory-headless.agentmemory.svc.cluster.local:4180/agentmemory/status',
];
async function request(endpoint, token, waitForRouting = false) {
  const fetchRequest = waitForRouting ? fetchWhenServiceReady : fetch;
  return fetchRequest(endpoint, {
    redirect: 'manual', headers: { Host: 'memory.example.com', 'X-Forwarded-Proto': 'https',
      ...(token ? { Authorization: `Bearer ${token}` } : {}) }, signal: AbortSignal.timeout(30000),
  });
}
await Promise.all(endpoints.map(async (endpoint) => {
  assert.equal((await request(endpoint, undefined, true)).status, 401);
  await Promise.all([memorySecret, tokens.expired, tokens.wrongAudience, tokens.wrongIssuer,
    `${tokens.valid.slice(0, -10)}tampered`].map(async (token) => {
    assert.ok([401, 403].includes((await request(endpoint, token)).status), 'Invalid credentials must be denied without redirect');
  }));
  const authenticated = await request(endpoint, tokens.valid);
  assert.equal(authenticated.status, 200, await authenticated.text());
}));
// Headless DNS resolves the Pod IP: port 3111 would bypass the OIDC proxy if policy failed.
const addresses = await resolve4('memory-headless.agentmemory.svc.cluster.local');
assert.ok(addresses.length > 0);
await assert.rejects(fetch(`http://${addresses[0]}:3111/agentmemory/status`, {
  headers: { Authorization: `Bearer ${memorySecret}` }, signal: AbortSignal.timeout(5000),
}));
console.log('ClusterIP and headless OIDC API: valid JWT accepted; missing, memory, expired, wrong-audience/issuer and tampered tokens denied');
console.log('NetworkPolicy: direct Pod-IP backend access blocked from the separate client');
