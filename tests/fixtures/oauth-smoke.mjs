import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { connect } from 'node:net';
import { createRequire } from 'node:module';
import { setTimeout as delay } from 'node:timers/promises';
import { resolve4 } from 'node:dns/promises';
import { fetchWhenServiceReady } from '/fixture/service-client.mjs';

// Use the WebSocket implementation already locked in the candidate application.
const { WebSocket } = createRequire('/app/package.json')('ws');

const jar = new Map();
const publicOrigin = 'https://memory-ui.example.com';
const serviceHost = 'memory-ui.agentmemory.svc.cluster.local';
function websocket(path, authenticated = true, proxyHeaders = {}, origin = publicOrigin) {
  return new Promise((resolve, reject) => {
    const socket = connect(4180, serviceHost);
    const key = randomBytes(16).toString('base64');
    let response = '';
    const timeout = setTimeout(() => {
      socket.destroy();
      reject(new Error('Timed out waiting for the proxied WebSocket handshake'));
    }, 10000);
    socket.on('error', (error) => { clearTimeout(timeout); reject(error); });
    socket.on('connect', () => socket.write([
      `GET ${path} HTTP/1.1`,
      'Host: memory-ui.example.com',
      'X-Forwarded-Proto: https',
      `Origin: ${origin}`,
      ...Object.entries(proxyHeaders).map(([name, value]) => `${name}: ${value}`),
      ...(authenticated ? [`Cookie: ${[...jar].map(([k, v]) => `${k}=${v}`).join('; ')}`] : []),
      'Connection: Upgrade',
      'Upgrade: websocket',
      `Sec-WebSocket-Key: ${key}`,
      'Sec-WebSocket-Version: 13',
      '', '',
    ].join('\r\n')));
    socket.on('data', (chunk) => {
      response += chunk.toString('latin1');
      if (response.includes('\r\n\r\n')) {
        clearTimeout(timeout);
        socket.destroy();
        resolve(response.split('\r\n', 1)[0]);
      }
    });
  });
}
async function proxy(path, authenticated = true) {
  const response = await fetchWhenServiceReady(`http://${serviceHost}:4180${path}`, {
    redirect: 'manual', headers: { Host: 'memory-ui.example.com', 'X-Forwarded-Proto': 'https',
      ...(authenticated ? { Cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; ') } : {}) },
    signal: AbortSignal.timeout(30000),
  });
  for (const cookie of response.headers.getSetCookie()) {
    const pair = cookie.split(';')[0]; const index = pair.indexOf('=');
    jar.set(pair.slice(0, index), pair.slice(index + 1));
  }
  return response;
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
assert.match(await html.text(), /agentmemory viewer/);
const status = await proxy('/agentmemory/status');
assert.equal(status.status, 200, await status.text());
assert.match(await websocket('/', false), /^HTTP\/1\.1 (302|401|403) /, 'unauthenticated root WebSocket must be denied');
assert.equal(await websocket('/', true), 'HTTP/1.1 101 Switching Protocols', 'authenticated root WebSocket must reach the engine upstream');
for (const proxyHeaders of [
  { 'X-Forwarded-Host': 'gateway-a.internal', 'X-Forwarded-Proto': 'http' },
  { 'X-Forwarded-Host': 'memory-ui.example.com, gateway-b.internal', 'X-Forwarded-Proto': 'https, http' },
]) {
  assert.equal(await websocket('/', true, proxyHeaders), 'HTTP/1.1 101 Switching Protocols', 'the same session must survive changing proxy headers without affinity');
}
assert.equal(await websocket('/', true, {
  'X-Forwarded-Host': 'attacker.example.com', 'X-Forwarded-Proto': 'https',
}, 'https://attacker.example.com'), 'HTTP/1.1 403 Forbidden', 'forwarded headers must not override the configured public origin');

async function receiveLiveMemoryEvent() {
  const marker = `caddy-live-${randomBytes(8).toString('hex')}`;
  const socket = new WebSocket(`ws://${serviceHost}:4180/`, { headers: {
    Host: 'memory-ui.example.com', Origin: publicOrigin, 'X-Forwarded-Proto': 'https',
    Cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; '),
  }, handshakeTimeout: 10000 });
  let timer;
  const received = new Promise((resolve, reject) => {
    timer = setTimeout(() => reject(new Error('No live memory event arrived through OAuth2 Proxy and Caddy')), 20000);
    socket.on('error', reject);
    socket.on('message', (data) => {
      if (data.toString().includes(marker)) resolve();
    });
  });
  // Attach rejection handling immediately, including if the upgrade fails.
  received.catch(() => {});
  try {
    await new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
    socket.send(JSON.stringify({ type: 'join', data: {
      subscriptionId: marker, streamName: 'mem-live', groupId: 'viewer',
    } }));
    await delay(200); // Let the engine register the viewer subscription before the write.
    const response = await fetch(`http://${serviceHost}:4180/agentmemory/remember`, {
      method: 'POST', headers: { Host: 'memory-ui.example.com', 'X-Forwarded-Proto': 'https',
        Origin: publicOrigin, 'Content-Type': 'application/json',
        Cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; ') },
      body: JSON.stringify({ content: marker, type: 'fact', project: '/integration' }),
      signal: AbortSignal.timeout(15000),
    });
    assert.equal(response.status, 201, await response.text());
    await received;
  } finally {
    clearTimeout(timer);
    socket.terminate();
  }
}
await receiveLiveMemoryEvent();
const [podIp] = await resolve4('memory-headless.agentmemory.svc.cluster.local');
for (const port of [4181, 3113, 443]) {
  await assert.rejects(fetch(`http://${podIp}:${port}/`, { signal: AbortSignal.timeout(1500) }),
    `private UI backend port ${port} must not be reachable from another Pod`);
}
console.log('OIDC/Caddy: PKCE login, group restriction, secure cookie, UI/API, protected root WebSocket, live memory events and session reuse across changing proxy headers passed');
