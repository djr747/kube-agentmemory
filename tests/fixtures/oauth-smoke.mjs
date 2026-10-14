import assert from 'node:assert/strict';

const jar = new Map();
const publicOrigin = 'https://memory-ui.example.com';
async function proxy(path, authenticated = true) {
  const response = await fetch(`http://127.0.0.1:4180${path}`, {
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
const start = await proxy('/oauth2/start?rd=/');
assert.equal(start.status, 302);
const authorize = new URL(start.headers.get('location'));
assert.equal(authorize.origin, 'http://oidc-fixture.agentmemory.svc.cluster.local:8080');
assert.equal(authorize.searchParams.get('code_challenge_method'), 'S256');
const approved = await fetch(authorize, { redirect: 'manual' });
assert.equal(approved.status, 302);
const callback = new URL(approved.headers.get('location'));
assert.equal(callback.origin, publicOrigin);
const completed = await proxy(`${callback.pathname}${callback.search}`);
assert.equal(completed.status, 302, await completed.text());
assert.ok(completed.headers.getSetCookie().some((cookie) => cookie.includes('Secure') && cookie.includes('HttpOnly')));
assert.equal((await proxy('/oauth2/auth')).status, 202);
const html = await proxy('/');
assert.equal(html.status, 200);
assert.match(await html.text(), /agentmemory viewer/);
const status = await proxy('/agentmemory/status');
assert.equal(status.status, 200, await status.text());
console.log('OIDC sidecar: unauthorized denial, PKCE login, secure cookie, UI and authenticated API passed');
