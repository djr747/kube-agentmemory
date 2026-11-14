import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { request } from 'node:https';
import { Readable } from 'node:stream';
import { resolve4 } from 'node:dns/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { fetchWhenServiceReady } from '/fixture/service-client.mjs';

const jar = new Map();
const publicOrigin = 'https://memory-ui.example.com';
const serviceHost = 'memory-ui.agentmemory.svc.cluster.local';
const ingress = process.argv.includes('--ingress');
const snapshotPath = '/agentmemory/viewer/snapshot';
const memoryListPath = '/agentmemory/memories?latest=true&limit=100';
// Connect to the controller while preserving the public TLS name, certificate
// validation and HTTP Host that a browser would send.
const ingressIp = ingress ? (await resolve4('traefik.traefik.svc.cluster.local'))[0] : undefined;
const ca = ingress ? readFileSync('/fixture/ingress.crt') : undefined;
function httpsRequest(path, { headers, signal, method, body }) {
  return new Promise((resolve, reject) => {
    const req = request(new URL(path, publicOrigin), { headers, signal, method, ca,
      lookup: (_host, options, callback) => options.all
        ? callback(null, [{ address: ingressIp, family: 4 }]) : callback(null, ingressIp, 4),
    }, (res) => resolve(new Response(Readable.toWeb(res), {
      status: res.statusCode, headers: Array.from({ length: res.rawHeaders.length / 2 },
        (_, index) => res.rawHeaders.slice(index * 2, index * 2 + 2)),
    })));
    req.once('error', reject);
    req.end(body);
  });
}
async function proxy(path, authenticated = true, options = {}) {
  const { headers: extraHeaders, ...rest } = options;
  const config = { redirect: 'manual', signal: AbortSignal.timeout(30000), ...rest,
    headers: { Host: 'memory-ui.example.com', ...(!ingress ? { 'X-Forwarded-Proto': 'https' } : {}),
      ...(authenticated ? { Cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; ') } : {}), ...extraHeaders },
  };
  const response = ingress ? await httpsRequest(path, config)
    : await fetchWhenServiceReady(`http://${serviceHost}:4180${path}`, config);
  for (const cookie of response.headers.getSetCookie()) {
    const pair = cookie.split(';')[0]; const index = pair.indexOf('=');
    jar.set(pair.slice(0, index), pair.slice(index + 1));
  }
  return response;
}
if (ingress) {
  const deadline = Date.now() + 60000;
  let ready = false;
  do {
    const ping = await proxy('/ping', false, { signal: AbortSignal.timeout(3000) });
    ready = ping.status === 200;
    if (!ready) await delay(1000);
  } while (!ready && Date.now() < deadline);
  assert.ok(ready, 'Traefik did not route requests to the UI proxy');
}
assert.equal((await proxy('/oauth2/auth', false)).status, 401);
assert.equal((await proxy('/agentmemory/status', false)).status, 401);
async function login(noGroups = false) {
  const start = await proxy('/oauth2/start?rd=/');
  assert.equal(start.status, 302);
  const authorize = new URL(start.headers.get('location'));
  assert.equal(authorize.origin, 'http://oidc-fixture.agentmemory.svc.cluster.local:8080');
  assert.equal(authorize.searchParams.get('code_challenge_method'), 'S256');
  if (noGroups) authorize.searchParams.set('test_no_groups', 'true');
  const approved = await fetch(authorize, { redirect: 'manual' });
  assert.equal(approved.status, 302);
  const callback = new URL(approved.headers.get('location'));
  assert.equal(callback.origin, publicOrigin);
  return proxy(`${callback.pathname}${callback.search}`);
}
assert.equal((await login(true)).status, 403, 'users outside the allowed group must not get a session');
assert.equal((await proxy('/oauth2/auth')).status, 401);
jar.clear();
const completed = await login();
assert.equal(completed.status, 302, await completed.text());
assert.ok(completed.headers.getSetCookie().some((cookie) => cookie.includes('Secure') && cookie.includes('HttpOnly')));
assert.equal((await proxy('/oauth2/auth')).status, 202);
const html = await proxy('/');
assert.equal(html.status, 200);
const viewer = await html.text();
assert.match(viewer, /agentmemory viewer/);
assert.match(viewer, /LIVE_EVENTS_URL[^\n]+\/agentmemory\/viewer\/events/);
assert.match(viewer, /Accept:\s*['"]text\/event-stream['"]/);
const status = await proxy('/agentmemory/status');
assert.equal(status.status, 200, await status.text());
const events = '/agentmemory/viewer/events';
assert.equal((await proxy(events, false)).status, 401, 'an anonymous client must not open the live feed');
if (ingress) {
  const expected = JSON.parse(process.argv[process.argv.indexOf('--ingress') + 1]);
  assert.ok(expected.id && expected.marker, 'the check needs a memory from the previous release');
  const rejected = await proxy('/', true, { headers: {
    Connection: 'Upgrade', Upgrade: 'websocket', Origin: publicOrigin,
    'Sec-WebSocket-Version': '13', 'Sec-WebSocket-Key': randomBytes(16).toString('base64'),
  } });
  assert.equal(rejected.status, 403, 'the HTTPS Ingress must reject the legacy WebSocket upgrade');
  await rejected.body?.cancel();
  const detailPath = `/agentmemory/memories/${encodeURIComponent(expected.id)}`;
  for (const path of [snapshotPath, memoryListPath, detailPath]) {
    const anonymous = await proxy(path, false);
    assert.equal(anonymous.status, 401, `anonymous viewer data request to ${path}`);
    await anonymous.body?.cancel();
  }
  const snapshot = await proxy(snapshotPath);
  assert.equal(snapshot.status, 200);
  const data = await snapshot.json();
  assert.equal(data.service, 'agentmemory');
  assert.ok(data.counts.latestMemories > 0, 'the initial snapshot must report saved memories');
  const list = await proxy(memoryListPath);
  assert.equal(list.status, 200);
  assert.ok((await list.json()).memories.some((memory) => memory.id === expected.id),
    'the viewer list must include the memory saved before the upgrade');
  const detail = await proxy(detailPath);
  assert.equal(detail.status, 200);
  const { memory } = await detail.json();
  assert.equal(memory.id, expected.id);
  assert.ok(memory.content.includes(expected.marker));
  console.log('HTTPS Traefik Ingress: authenticated initial snapshot, memory list and migrated record detail passed');
}
if (!ingress) {
  for (const headers of [
    { 'X-Forwarded-Host': 'gateway-a.internal', 'X-Forwarded-Proto': 'http' },
    { 'X-Forwarded-Host': 'memory-ui.example.com, gateway-b.internal', 'X-Forwarded-Proto': 'https, http' },
  ]) assert.equal((await proxy('/agentmemory/status', true, { headers })).status, 200);
}
const controller = new AbortController();
const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(25000)]);
const marker = `ingress-live-${randomBytes(8).toString('hex')}`;
try {
  const response = await proxy(events, true, { headers: { Accept: 'text/event-stream' }, signal });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /^text\/event-stream/);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = '';
  async function nextFrame() {
    while (!pending.includes('\n\n')) {
      const { done, value } = await reader.read();
      assert.equal(done, false, 'the live feed ended before delivering the memory');
      pending += decoder.decode(value, { stream: true }).replaceAll('\r', '');
      assert.ok(pending.length < 1024 * 1024, 'oversized event frame');
    }
    const end = pending.indexOf('\n\n');
    const frame = pending.slice(0, end);
    pending = pending.slice(end + 2);
    return frame;
  }
  assert.equal(await nextFrame(), ': connected');
  const remembered = await proxy('/agentmemory/remember', true, { method: 'POST', headers: {
    Origin: publicOrigin, 'Content-Type': 'application/json',
  }, body: JSON.stringify({ content: marker, type: 'fact', project: '/integration' }) });
  assert.equal(remembered.status, 201, 'authenticated memory write through viewer');
  const id = (await remembered.json()).memory.id;
  assert.ok(id);
  while (true) {
    const frame = await nextFrame();
    const payload = frame.split('\n').find((line) => line.startsWith('data: '));
    if (!payload) continue;
    const event = JSON.parse(payload.slice(6));
    if (event.data?.memoryId === id && event.type === 'memory.created') break;
  }
} finally {
  controller.abort();
}
const [podIp] = await resolve4('memory-headless.agentmemory.svc.cluster.local');
for (const port of [4181, 3113, 49134]) {
  await assert.rejects(fetch(`http://${podIp}:${port}/`, { signal: AbortSignal.timeout(1500) }),
    `private UI backend port ${port} must not be reachable from another Pod`);
}
console.log(ingress
  ? 'HTTPS Traefik Ingress: OIDC PKCE login and live memory creation via authenticated SSE passed with WebSocket upgrades blocked'
  : 'OIDC UI Service: PKCE, group restrictions, secure cookies, live memory events and session reuse passed');
