import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { parseAllDocuments } from 'yaml';

const image = execFileSync('node', ['tests/external-image.mjs', 'caddy'], { encoding: 'utf8' }).trim();
function flatten(routes) {
  return routes.flatMap((route) => (route.handle || []).flatMap((handler) =>
    handler.handler === 'subroute' ? flatten(handler.routes) : [{ ...handler, match: route.match }]));
}
for (const port of [443, 3212]) {
  const rendered = execFileSync('helm', ['template', 'memory', 'charts/kube-agentmemory',
    '--set', 'secrets.existingSecret=auth', '--set', 'image.tag=dev', '--set', 'engine.image.tag=dev',
    '-f', 'examples/oauth2-proxy.yaml', '--set', `engine.streamPort=${port}`], { encoding: 'utf8' });
  const config = parseAllDocuments(rendered).map((d) => d.toJSON()).find((d) => d?.kind === 'ConfigMap' && d.metadata.name.endsWith('-caddy')).data.Caddyfile;
  const adapted = execFileSync('docker', ['run', '--rm', '-i', '--network', 'none', '--read-only',
    '--user', '65532:65532', '--cap-drop', 'ALL', '--cap-add', 'NET_BIND_SERVICE',
    '--security-opt', 'no-new-privileges', '--entrypoint', 'caddy', image,
    'adapt', '--config', '/dev/stdin', '--adapter', 'caddyfile'], { input: config, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
  const servers = Object.values(JSON.parse(adapted).apps.http.servers);
  assert.equal(servers.length, 1);
  assert.deepEqual(servers[0].listen, ['127.0.0.1:4181']);
  const handlers = flatten(servers[0].routes);
  assert.deepEqual(handlers.slice(0, 2).map((h) => [h.handler, h.status_code]), [['static_response', 200], ['static_response', 403]],
    'health and origin responses must precede every proxy handler');
  assert.deepEqual(handlers[0].match, [{ path: ['/healthz'] }]);
  assert.deepEqual(handlers[1].match[0].not, [{ header: { Origin: ['https://memory-ui.example.com'] } }]);
  assert.deepEqual(handlers.filter((h) => h.handler === 'reverse_proxy').map((h) => h.upstreams[0].dial),
    [`127.0.0.1:${port}`, '127.0.0.1:3113']);
}
console.log('Stock Caddy: configuration parses, health/origin checks precede proxying, and engine.streamPort selects the backend at 443 and 3212');
