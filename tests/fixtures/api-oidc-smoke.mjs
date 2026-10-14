import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve4 } from 'node:dns/promises';
import { setTimeout as delay } from 'node:timers/promises';

const tokens = await (await fetch('http://127.0.0.1:8080/test-tokens')).json();
const memorySecret = process.env.AGENTMEMORY_SECRET || readFileSync(process.env.AGENTMEMORY_SECRET_FILE, 'utf8').trim();
async function request(token, waitForRouting = false) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fetch('http://memory.agentmemory.svc.cluster.local:3111/agentmemory/status', {
        redirect: 'manual', headers: { Host: 'memory.example.com', 'X-Forwarded-Proto': 'https',
          ...(token ? { Authorization: `Bearer ${token}` } : {}) }, signal: AbortSignal.timeout(30000),
      });
    } catch (error) {
      // Ready Pods precede kube-proxy's replacement Service routes. Retry only
      // the initial refused connection; never retry an HTTP/authentication result.
      if (!waitForRouting || error.cause?.code !== 'ECONNREFUSED' || attempt >= 30) throw error;
      await delay(1000);
    }
  }
}
assert.equal((await request(undefined, true)).status, 401);
for (const token of [memorySecret, tokens.expired, tokens.wrongAudience, tokens.wrongIssuer, `${tokens.valid.slice(0, -10)}tampered`]) {
  assert.ok([401, 403].includes((await request(token)).status), 'Invalid credentials must be denied without redirect');
}
const authenticated = await request(tokens.valid);
assert.equal(authenticated.status, 200, await authenticated.text());
// Headless DNS resolves the Pod IP: port 3111 would bypass the OIDC proxy if policy failed.
const addresses = await resolve4('memory-headless.agentmemory.svc.cluster.local');
assert.ok(addresses.length > 0);
await assert.rejects(fetch(`http://${addresses[0]}:3111/agentmemory/status`, {
  headers: { Authorization: `Bearer ${memorySecret}` }, signal: AbortSignal.timeout(5000),
}));
console.log('OIDC API: valid signed JWT accepted; missing, memory, expired, wrong-audience/issuer and tampered tokens denied');
console.log('NetworkPolicy: direct Pod-IP backend access blocked from the separate client');
