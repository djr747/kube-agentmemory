import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { stringify, parse } from 'yaml';

const image = process.env.IMAGE || 'kube-agentmemory:dev';
const engineImage = process.env.ENGINE_IMAGE || 'kube-agentmemory-engine:dev';
assert.match(image, /^[a-zA-Z0-9./_-]+:[a-zA-Z0-9._-]+$/, 'Use a tagged candidate image');
assert.match(engineImage, /^[a-zA-Z0-9./_-]+:[a-zA-Z0-9._-]+$/, 'Use a tagged engine image');
const cluster = process.env.INTEGRATION_CLUSTER || `agentmemory-integration-${process.pid}`;
assert.match(cluster, /^agentmemory-integration-[a-z0-9-]+$/, 'Use a disposable integration cluster');
const context = `kind-${cluster}`;
const apiServicePort = 8080; // Deliberately different from either container listener.
const results = resolve(process.env.RESULTS || 'test-results');
const temp = mkdtempSync(join(tmpdir(), 'agentmemory-integration-'));
const reuse = process.env.REUSE_CLUSTER === 'true';
assert.ok(!reuse || process.env.KUBECONFIG, 'REUSE_CLUSTER requires an explicit KUBECONFIG');
const env = { ...process.env, KUBECONFIG: reuse ? process.env.KUBECONFIG : join(temp, 'kubeconfig') };
let created = false;
mkdirSync(results, { recursive: true });
function run(command, args, options = {}) {
  return execFileSync(command, args, { env, stdio: 'inherit', ...options });
}
function capture(command, args) {
  return run(command, args, { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' }).trim();
}
const kube = (args, options) => run('kubectl', ['--context', context, '-n', 'agentmemory', ...args], options);
const smoke = (mode, state) => kube(['exec', 'memory-0', '-c', 'app', '--',
  'node', '/app/tests/smoke.mjs', mode, ...(state ? [state] : [])]);
function diagnostics() {
  for (const [file, args] of [
    ['cluster.txt', ['get', 'pods,pvc,events', '-o', 'wide']],
    ['services.json', ['get', 'services,endpointslices', '-o', 'json']],
    ['app.log', ['logs', 'memory-0', '-c', 'app']],
    ['engine.log', ['logs', 'memory-0', '-c', 'engine']],
    ['oauth2-proxy.log', ['logs', 'memory-0', '-c', 'oauth2-proxy']],
  ]) {
    try { writeFileSync(join(results, file), capture('kubectl', ['--context', context, '-n', 'agentmemory', ...args])); }
    catch { /* Preserve the original test failure even when diagnostics are unavailable. */ }
  }
}
try {
  if (!reuse) {
    const clusters = capture('kind', ['get', 'clusters']).split('\n');
    assert.ok(!clusters.includes(cluster), 'Refusing to adopt an existing cluster');
    // Mark before creation so partial clusters are cleaned up on failure too.
    created = true;
    run('kind', ['create', 'cluster', '--name', cluster, '--wait', '180s']);
  }
  run('kind', ['load', 'docker-image', image, engineImage, '--name', cluster]);
  const ns = capture('kubectl', ['--context', context, 'create', 'namespace', 'agentmemory', '--dry-run=client', '-o', 'yaml']);
  run('kubectl', ['--context', context, 'apply', '-f', '-'], { input: ns, stdio: ['pipe', 'inherit', 'inherit'] });
  run('kubectl', ['--context', context, 'label', 'namespace', 'agentmemory', 'pod-security.kubernetes.io/enforce=restricted', '--overwrite']);
  const credential = join(temp, 'AGENTMEMORY_SECRET');
  writeFileSync(credential, randomBytes(32).toString('hex'), { mode: 0o600 });
  const secret = capture('kubectl', ['--context', context, '-n', 'agentmemory', 'create', 'secret', 'generic',
    'agentmemory-auth', `--from-file=AGENTMEMORY_SECRET=${credential}`, '--dry-run=client', '-o', 'yaml']);
  kube(['apply', '-f', '-'], { input: secret, stdio: ['pipe', 'inherit', 'inherit'] });
  rmSync(credential);
  const version = JSON.parse(readFileSync('package.json')).version;
  // CI consumes the validation job's archive so publication reuses the tested bytes.
  if (!process.env.CHART_ARCHIVE_DIR) run('node', ['tests/package-chart.mjs', results]);
  const archive = resolve(process.env.CHART_ARCHIVE_DIR || results, `kube-agentmemory-${version}.tgz`);
  const metadata = parse(capture('helm', ['show', 'chart', archive]));
  assert.equal(metadata.version, version);
  assert.equal(metadata.appVersion, version);
  const imageParts = image.split(':');
  const engineParts = engineImage.split(':');
  function deploy(files, apiListener = 3111) {
    run('helm', ['upgrade', '--install', 'memory', archive, '--kube-context', context, '-n', 'agentmemory',
      '--set', 'fullnameOverride=memory', '--set', `image.repository=${imageParts[0]}`,
      '--set', `image.tag=${imageParts[1]}`, '--set', 'image.pullPolicy=Never', '--set', 'persistence.size=1Gi',
      '--set', `service.port=${apiServicePort}`,
      '--set', `engine.image.repository=${engineParts[0]}`, '--set', `engine.image.tag=${engineParts[1]}`,
      '--set', 'engine.image.pullPolicy=Never',
      ...files.flatMap((file) => ['-f', file]), '--wait', '--timeout', '600s']);
    kube(['rollout', 'status', 'statefulset/memory', '--timeout=600s']);
    kube(['wait', '--for=condition=Ready', 'pod/memory-0', '--timeout=600s']);
    const services = JSON.parse(capture('kubectl', ['--context', context, '-n', 'agentmemory',
      'get', 'services', 'memory', 'memory-headless', '-o', 'json'])).items;
    const primary = services.find((s) => s.metadata.name === 'memory');
    const headless = services.find((s) => s.metadata.name === 'memory-headless');
    assert.equal(primary.spec.ports[0].port, apiServicePort);
    assert.equal(primary.spec.ports[0].targetPort, apiListener);
    assert.equal(headless.spec.ports[0].port, apiListener);
    assert.equal(headless.spec.ports[0].targetPort, apiListener);
  }
  deploy(['examples/local.yaml']);
  smoke('write');
  kube(['exec', 'memory-0', '-c', 'app', '--', 'node', '-e',
    "require('fs').copyFileSync('/tmp/agentmemory-test.json','/data/integration-test.json')"]);
  const uid = () => capture('kubectl', ['--context', context, '-n', 'agentmemory', 'get', 'pod', 'memory-0', '-o', 'jsonpath={.metadata.uid}']);
  const before = uid();
  kube(['delete', 'pod', 'memory-0', '--wait=true']);
  // rollout status also waits for the replacement to exist, avoiding a get/wait race.
  kube(['rollout', 'status', 'statefulset/memory', '--timeout=600s']);
  kube(['wait', '--for=condition=Ready', 'pod/memory-0', '--timeout=600s']);
  assert.notEqual(uid(), before, 'Pod must be replaced for persistence test');
  smoke('read', '/data/integration-test.json');
  deploy(['examples/local.yaml', 'examples/mounted-secret.yaml']);
  smoke('read', '/data/integration-test.json');
  run('helm', ['uninstall', 'memory', '--kube-context', context, '-n', 'agentmemory', '--wait']);
  kube(['get', 'pvc', 'data-memory-0']);
  deploy(['examples/local.yaml']);
  smoke('read', '/data/integration-test.json');
  // Exercise the optional real OAuth2 Proxy sidecar against a disposable local OIDC issuer.
  const clientSecret = randomBytes(32).toString('hex');
  const cookieSecret = randomBytes(32);
  const oauthSecret = { apiVersion: 'v1', kind: 'Secret', metadata: { name: 'oauth-integration' }, type: 'Opaque',
    stringData: { OAUTH2_PROXY_CLIENT_SECRET: clientSecret, OAUTH2_PROXY_COOKIE_SECRET: cookieSecret.toString('base64url') },
    data: { 'cookie-secret': cookieSecret.toString('base64') } };
  kube(['apply', '-f', '-'], { input: stringify(oauthSecret), stdio: ['pipe', 'inherit', 'inherit'] });
  const fixture = [
    { apiVersion: 'v1', kind: 'ConfigMap', metadata: { name: 'oidc-fixture' }, data: {
      'server.mjs': readFileSync('tests/fixtures/oidc-fixture.mjs', 'utf8'),
      'service-client.mjs': readFileSync('tests/fixtures/service-client.mjs', 'utf8'),
    } },
    { apiVersion: 'apps/v1', kind: 'Deployment', metadata: { name: 'oidc-fixture' }, spec: { replicas: 1, selector: { matchLabels: { app: 'oidc-fixture' } }, template: {
      metadata: { labels: { app: 'oidc-fixture' } }, spec: { automountServiceAccountToken: false,
        securityContext: { runAsNonRoot: true, runAsUser: 65532, runAsGroup: 65532, seccompProfile: { type: 'RuntimeDefault' } },
        containers: [{ name: 'issuer', image, imagePullPolicy: 'Never', command: ['node', '/fixture/server.mjs'],
          env: [{ name: 'ISSUER_URL', value: 'http://oidc-fixture.agentmemory.svc.cluster.local:8080' },
            { name: 'API_SERVICE_PORT', value: String(apiServicePort) },
            { name: 'CLIENT_SECRET', valueFrom: { secretKeyRef: { name: 'oauth-integration', key: 'OAUTH2_PROXY_CLIENT_SECRET' } } },
            { name: 'AGENTMEMORY_SECRET', valueFrom: { secretKeyRef: { name: 'agentmemory-auth', key: 'AGENTMEMORY_SECRET' } } }],
          securityContext: { allowPrivilegeEscalation: false, readOnlyRootFilesystem: true, capabilities: { drop: ['ALL'] } },
          ports: [{ containerPort: 8080 }], readinessProbe: { httpGet: { path: '/.well-known/openid-configuration', port: 8080 } },
          resources: { requests: { cpu: '50m', memory: '64Mi' }, limits: { cpu: '500m', memory: '128Mi' } },
          volumeMounts: [{ name: 'fixture', mountPath: '/fixture', readOnly: true }] }],
        volumes: [{ name: 'fixture', configMap: { name: 'oidc-fixture' } }] } } } },
    { apiVersion: 'v1', kind: 'Service', metadata: { name: 'oidc-fixture' }, spec: { selector: { app: 'oidc-fixture' }, ports: [{ port: 8080, targetPort: 8080 }] } },
  ];
  kube(['apply', '-f', '-'], { input: fixture.map((doc) => stringify(doc)).join('---\n'), stdio: ['pipe', 'inherit', 'inherit'] });
  kube(['rollout', 'status', 'deployment/oidc-fixture', '--timeout=120s']);
  const apiBearerSmoke = () => kube(['exec', '-i', 'deployment/oidc-fixture', '-c', 'issuer', '--', 'node', '--input-type=module'], {
    input: readFileSync('tests/fixtures/api-bearer-smoke.mjs'), stdio: ['pipe', 'inherit', 'inherit'],
  });
  apiBearerSmoke();
  const oauthValues = join(temp, 'oauth-values.yaml');
  writeFileSync(oauthValues, stringify({ oauth2Proxy: { enabled: true,
    issuerUrl: 'http://oidc-fixture.agentmemory.svc.cluster.local:8080', clientId: 'agentmemory-integration',
    uiHost: 'memory-ui.example.com', redirectUrl: 'https://memory-ui.example.com/oauth2/callback', emailDomains: ['test.example'], existingSecret: 'oauth-integration' },
    env: { VIEWER_ALLOWED_ORIGINS: 'https://memory-ui.example.com' }, networkPolicy: { egress: [
      { to: [{ podSelector: { matchLabels: { app: 'oidc-fixture' } } }], ports: [{ protocol: 'TCP', port: 8080 }] },
    ] } }));
  deploy(['examples/local.yaml', oauthValues]);
  smoke('read', '/data/integration-test.json'); // Official bearer integrations still work with SSO enabled.
  apiBearerSmoke();
  const oauthSmoke = () => kube(['exec', '-i', 'memory-0', '-c', 'app', '--', 'node', '--input-type=module'], {
    input: readFileSync('tests/fixtures/oauth-smoke.mjs'), stdio: ['pipe', 'inherit', 'inherit'],
  });
  oauthSmoke();
  // Validate native file options too, including the raw binary cookie key format.
  const oauthFiles = join(temp, 'oauth-files.yaml');
  writeFileSync(oauthFiles, stringify({ oauth2Proxy: { existingSecret: '',
    secretFiles: { clientSecret: '/oauth-credentials/OAUTH2_PROXY_CLIENT_SECRET', cookieSecret: '/oauth-credentials/cookie-secret' },
    extraVolumeMounts: [{ name: 'oauth-credentials', mountPath: '/oauth-credentials', readOnly: true }] },
    extraVolumes: [{ name: 'oauth-credentials', secret: { secretName: 'oauth-integration', defaultMode: 0o440 } }] }));
  deploy(['examples/local.yaml', oauthValues, oauthFiles]);
  smoke('read', '/data/integration-test.json');
  oauthSmoke();
  const protectedApi = join(temp, 'protected-api.yaml');
  writeFileSync(protectedApi, stringify({ oauth2Proxy: { protectApi: true, skipJwtBearerTokens: true } }));
  deploy(['examples/local.yaml', oauthValues, oauthFiles, protectedApi], 4180);
  oauthSmoke();
  // A separate client reaches the Service without requiring app-to-itself Service egress.
  kube(['exec', '-i', 'deployment/oidc-fixture', '-c', 'issuer', '--', 'node', '--input-type=module'], {
    input: readFileSync('tests/fixtures/api-oidc-smoke.mjs'), stdio: ['pipe', 'inherit', 'inherit'],
  });
  console.log('Packaged chart: environment/file credentials, real local vectors, restart and reinstall persistence passed');
} catch (error) {
  diagnostics();
  console.error(error.message);
  process.exitCode = 1;
} finally {
  if (created) {
    try { run('kind', ['delete', 'cluster', '--name', cluster]); }
    catch { process.exitCode = 1; }
  }
  rmSync(temp, { recursive: true, force: true });
}
