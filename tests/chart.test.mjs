import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { parseAllDocuments, parse } from 'yaml';
import { readFileSync } from 'node:fs';

const chart = 'charts/kube-agentmemory';
function render(args = [], expectSuccess = true) {
  const result = spawnSync('helm', ['template', 'memory', chart, '--kube-version', '1.30.0',
    '--set', 'image.tag=dev', '--set', 'engine.image.tag=dev', ...args], { encoding: 'utf8' });
  if (!expectSuccess) {
    assert.notEqual(result.status, 0);
    return result.stderr;
  }
  assert.equal(result.status, 0, result.stderr);
  return parseAllDocuments(result.stdout).map((document) => {
    assert.deepEqual(document.errors, []);
    return document.toJSON();
  }).filter(Boolean);
}
const auth = ['--set', 'secrets.existingSecret=auth'];
function appConfig(args = []) {
  const { spec, metadata } = render([...auth, ...args]).find((m) => m.kind === 'StatefulSet').spec.template;
  const env = spec.containers.find((container) => container.name === 'app').env;
  return { env: Object.fromEntries(env.map((entry) => [entry.name, entry.value])), checksum: metadata.annotations['checksum/config'] };
}
test('single writer, retained storage, restricted containers and private engine ports', () => {
  const manifests = render(auth);
  const sts = manifests.find((m) => m.kind === 'StatefulSet');
  assert.equal(sts.metadata.name, 'memory');
  assert.equal(sts.spec.replicas, 1);
  assert.equal(sts.spec.volumeClaimTemplates[0].apiVersion, 'v1');
  assert.equal(sts.spec.volumeClaimTemplates[0].kind, 'PersistentVolumeClaim');
  assert.equal(sts.spec.persistentVolumeClaimRetentionPolicy.whenDeleted, 'Retain');
  assert.equal(sts.spec.template.spec.automountServiceAccountToken, false);
  assert.equal(sts.spec.template.spec.securityContext.runAsNonRoot, true);
  const engineWork = sts.spec.template.spec.volumes.find((volume) => volume.name === 'engine-work');
  const engineStorage = sts.spec.template.spec.initContainers[0].resources;
  assert.equal(engineWork.emptyDir.sizeLimit, '4Gi');
  assert.equal(engineStorage.requests['ephemeral-storage'], '1Gi');
  assert.equal(engineStorage.limits['ephemeral-storage'], '5Gi');
  assert.equal(sts.spec.template.spec.initContainers[0].restartPolicy, 'Always');
  assert.equal(sts.spec.template.spec.initContainers[0].lifecycle.preStop.sleep.seconds, 5);
  assert.deepEqual(sts.spec.template.spec.initContainers[0].args, ['compose', '--namespace', 'agentmemory', '--up']);
  const configMount = sts.spec.template.spec.initContainers[0].volumeMounts.find((mount) => mount.name === 'engine-config');
  assert.equal(configMount.mountPath, '/app/config/worker-compose.yaml');
  assert.equal(configMount.subPath, 'worker-compose.yaml');
  assert.deepEqual(sts.spec.template.spec.initContainers[0].ports, [{ name: 'http', containerPort: 3111 }]);
  assert.equal(sts.spec.template.spec.containers.find((c) => c.name === 'app').env.find((e) => e.name === 'III_NAMESPACE').value, 'agentmemory');
  for (const container of [...sts.spec.template.spec.containers, ...sts.spec.template.spec.initContainers]) {
    assert.equal(container.securityContext.readOnlyRootFilesystem, true);
    assert.equal(container.securityContext.allowPrivilegeEscalation, false);
    assert.deepEqual(container.securityContext.capabilities.drop, ['ALL']);
    assert.ok(container.startupProbe);
    assert.match(container.resources.requests['ephemeral-storage'], /^\d+(Mi|Gi)$/);
    assert.match(container.resources.limits['ephemeral-storage'], /^\d+(Mi|Gi)$/);
  }
  for (const service of manifests.filter((m) => m.kind === 'Service')) {
    assert.deepEqual(service.spec.ports.map((p) => p.port), [3111]);
    assert.ok(service.spec.ports.every((p) => p.targetPort === 3111));
  }
  const config = manifests.find((m) => m.kind === 'ConfigMap').data['worker-compose.yaml'];
  assert.match(config, /iii-worker-manager:/);
  assert.match(config, /file_path: \/data\/state_store\.db/);
  assert.match(config, /package:\/\/api\.workers\.iii\.dev\/state/);
  assert.match(config, /package:\/\/api\.workers\.iii\.dev\/http/);
  assert.equal(parse(config).containers.state.config_override.adapter.config.save_interval_ms, 2000,
    'the state worker schema requires a numeric save interval');
  const net = manifests.find((m) => m.kind === 'NetworkPolicy');
  assert.deepEqual(net.spec.policyTypes, ['Ingress', 'Egress']);
  assert.deepEqual(net.spec.ingress[0].ports, [{ protocol: 'TCP', port: 3111 }]);
});
test('chart LLM values opt in to each supported provider and render its settings', () => {
  const defaults = appConfig([]);
  assert.equal(defaults.env.AGENTMEMORY_LLM_PROVIDER, undefined);
  assert.equal(defaults.env.OPENAI_BASE_URL, undefined);
  const endpoint = 'http://model.example.test:4000/v1';
  for (const provider of ['anthropic', 'gemini', 'minimax', 'openai', 'openrouter']) {
    const key = provider.toUpperCase();
    const model = `${provider}-test-model`;
    const modelSetting = `llm.${provider}.model=${model}`;
    const hasCustomEndpoint = ['anthropic', 'minimax', 'openai'].includes(provider);
    const selection = hasCustomEndpoint ? `llm.${provider}.endpoint=${endpoint}` : `llm.provider=${provider}`;
    const configured = appConfig(['--set', selection, '--set', modelSetting]);
    assert.equal(configured.env.AGENTMEMORY_LLM_PROVIDER, provider);
    assert.equal(configured.env[`${key}_MODEL`], model);
    if (hasCustomEndpoint) assert.equal(configured.env[`${key}_BASE_URL`], endpoint);
  }
  const optedIn = appConfig(['--set', `llm.openai.endpoint=${endpoint}`, '--set', 'llm.openai.model=local-tier1',
    '--set', 'env.OPENAI_BASE_URL=http://old.example.test/v1', '--set', 'env.AGENTMEMORY_LLM_PROVIDER=anthropic']);
  assert.equal(optedIn.env.AGENTMEMORY_LLM_PROVIDER, 'openai');
  assert.equal(optedIn.env.OPENAI_BASE_URL, endpoint);
  assert.equal(optedIn.env.OPENAI_MODEL, 'local-tier1');
  assert.notEqual(optedIn.checksum, defaults.checksum);
  assert.equal(appConfig(['--set', 'env.AGENTMEMORY_LLM_PROVIDER=gemini']).env.AGENTMEMORY_LLM_PROVIDER, 'gemini');
  assert.equal(appConfig(['--set', `env.OPENAI_BASE_URL=${endpoint}`]).env.AGENTMEMORY_LLM_PROVIDER, undefined);
  assert.equal(appConfig(['--set', 'llm.gemini.model=gemini-test']).env.AGENTMEMORY_LLM_PROVIDER, undefined);
  const twoEndpoints = ['--set', `llm.openai.endpoint=${endpoint}`, '--set', 'llm.anthropic.endpoint=https://alternate.example.test'];
  assert.match(render([...auth, ...twoEndpoints], false), /Set llm.provider when more than one LLM endpoint is configured/);
  const explicit = appConfig([...twoEndpoints, '--set', 'llm.provider=anthropic']);
  assert.equal(explicit.env.AGENTMEMORY_LLM_PROVIDER, 'anthropic');
  assert.equal(explicit.env.OPENAI_BASE_URL, endpoint);
  assert.equal(explicit.env.ANTHROPIC_BASE_URL, 'https://alternate.example.test');
  assert.match(render([...auth, '--set', 'llm.openai.endpoint=ftp://model.example.test'], false), /llm.openai.endpoint/);
  assert.match(render([...auth, '--set', `llm.gemini.endpoint=${endpoint}`], false), /endpoint/);
  assert.match(render([...auth, '--set', `llm.openrouter.endpoint=${endpoint}`], false), /endpoint/);
});
test('typed request, feature, viewer and summary settings preserve the effective environment', () => {
  const legacy = appConfig([
    '--set-string', 'env.OPENAI_REASONING_EFFORT=none,env.OPENAI_TIMEOUT_MS=90000',
    '--set-string', 'env.AGENTMEMORY_AUTO_COMPRESS=true,env.CONSOLIDATION_ENABLED=true',
    '--set-string', 'env.AGENTMEMORY_SLOTS=true,env.AGENTMEMORY_REFLECT=true',
    '--set-string', 'env.SUMMARIZE_CHUNK_SIZE=64,env.SUMMARIZE_CHUNK_CONCURRENCY=1',
    '--set-string', 'env.VIEWER_ALLOWED_ORIGINS=https://memory.example.test\\,https://viewer.example.test'
  ]);
  const typed = appConfig([
    '--set', 'llm.openai.reasoningEffort=none,llm.openai.timeoutMs=90000',
    '--set', 'features.autoCompress=true,features.consolidation=true,features.graphExtraction=false',
    '--set', 'features.slots=true,features.reflection=true',
    '--set', 'summarization.chunkSize=64,summarization.chunkConcurrency=1',
    '--set-json', 'viewer.allowedOrigins=["https://memory.example.test","https://viewer.example.test"]'
  ]);
  assert.deepEqual(typed, legacy);
  assert.equal(typed.env.AGENTMEMORY_LLM_PROVIDER, undefined);
  assert.notEqual(typed.checksum, appConfig().checksum);
  const overrides = appConfig([
    '--set-string', 'env.GRAPH_EXTRACTION_ENABLED=true,env.VIEWER_ALLOWED_ORIGINS=https://old.example.test',
    '--set', 'features.graphExtraction=false',
    '--set-json', 'viewer.allowedOrigins=[]'
  ]);
  assert.equal(overrides.env.GRAPH_EXTRACTION_ENABLED, 'false');
  assert.equal(overrides.env.VIEWER_ALLOWED_ORIGINS, '');
  assert.match(render([...auth, '--set-string', 'features.autoCompress=true'], false), /features.autoCompress/);
  assert.match(render([...auth, '--set', 'summarization.chunkConcurrency=0'], false), /summarization.chunkConcurrency/);
  assert.match(render([...auth, '--set', 'llm.openai.timeoutMs=-1'], false), /llm.openai.timeoutMs/);
  assert.match(render([...auth, '--set-json', 'viewer.allowedOrigins=["*"]'], false), /viewer.allowedOrigins/);
});
test('embedding providers and their overrides are independent of LLM provider selection', () => {
  assert.equal(appConfig().env.EMBEDDING_PROVIDER, 'local');
  assert.equal(appConfig(['--set', 'env.EMBEDDING_PROVIDER=gemini']).env.EMBEDDING_PROVIDER, 'gemini');
  for (const provider of ['local', 'openai', 'gemini', 'openrouter', 'voyage', 'cohere', '']) {
    const { env } = appConfig(['--set-string', `embeddings.provider=${provider}`]);
    assert.equal(env.EMBEDDING_PROVIDER, provider);
    assert.equal(env.AGENTMEMORY_LLM_PROVIDER, undefined);
  }
  const { env } = appConfig([
    '--set', 'llm.provider=gemini,embeddings.provider=openai',
    '--set', 'embeddings.openai.endpoint=https://vectors.example.test/v1,embeddings.openai.model=custom',
    '--set', 'embeddings.openai.dimensions=1024',
    '--set', 'embeddings.openrouter.model=openai/text-embedding-3-small,embeddings.openrouter.dimensions=1536'
  ]);
  assert.equal(env.AGENTMEMORY_LLM_PROVIDER, 'gemini');
  assert.equal(env.EMBEDDING_PROVIDER, 'openai');
  assert.equal(env.OPENAI_EMBEDDING_BASE_URL, 'https://vectors.example.test/v1');
  assert.equal(env.OPENAI_EMBEDDING_MODEL, 'custom');
  assert.equal(env.OPENAI_EMBEDDING_DIMENSIONS, '1024');
  assert.equal(env.OPENROUTER_EMBEDDING_MODEL, 'openai/text-embedding-3-small');
  assert.equal(env.OPENROUTER_EMBEDDING_DIMENSIONS, '1536');
  assert.equal(env.OPENAI_BASE_URL, undefined);
  assert.match(render([...auth, '--set', 'embeddings.provider=unsupported'], false), /embeddings.provider/);
  assert.match(render([...auth, '--set', 'embeddings.openai.dimensions=0'], false), /embeddings.openai.dimensions/);
});
test('engine work volume and ephemeral-storage budget accept overrides', () => {
  const manifests = render([...auth, '--set', 'engine.workVolumeSizeLimit=8Gi',
    '--set', 'engine.resources.requests.ephemeral-storage=2Gi',
    '--set', 'engine.resources.limits.ephemeral-storage=9Gi']);
  const pod = manifests.find((m) => m.kind === 'StatefulSet').spec.template.spec;
  assert.equal(pod.volumes.find((v) => v.name === 'engine-work').emptyDir.sizeLimit, '8Gi');
  const engine = pod.initContainers.find((container) => container.name === 'engine');
  assert.equal(engine.resources.requests['ephemeral-storage'], '2Gi');
  assert.equal(engine.resources.limits['ephemeral-storage'], '9Gi');
  assert.match(render([...auth, '--set-string', 'engine.workVolumeSizeLimit='], false), /workVolumeSizeLimit/);
});
test('API OIDC is opt-in, removes direct ingress and changes both Service targets', () => {
  assert.match(render([...auth, '--set', 'oauth2Proxy.protectApi=true'], false), /requires oauth2Proxy.enabled/);
  for (const route of ['traefik-ingress', 'traefik-gateway']) {
    const docs = render([...auth, '-f', `examples/${route}.yaml`, '-f', 'examples/oauth2-proxy.yaml', '-f', 'examples/oauth2-api.yaml']);
    for (const service of docs.filter((m) => m.kind === 'Service' && !m.metadata.name.endsWith('-ui'))) {
      assert.ok(service.spec.ports.every((port) => port.targetPort === 4180));
    }
    const uiService = docs.find((m) => m.kind === 'Service' && m.metadata.name === 'memory-ui');
    assert.equal(uiService.spec.ports[0].targetPort, 4180);
    assert.deepEqual(docs.find((m) => m.kind === 'NetworkPolicy').spec.ingress[0].ports,
      [{ protocol: 'TCP', port: 4180 }]);
    const proxy = docs.find((m) => m.kind === 'StatefulSet').spec.template.spec.containers.find((c) => c.name === 'oauth2-proxy');
    assert.ok(proxy.args.includes('--skip-jwt-bearer-tokens=true'));
    assert.ok(proxy.args.includes('--proxy-websockets=false'));
    assert.ok(proxy.args.includes('--upstream=http://127.0.0.1:4181/'));
    assert.equal(proxy.args.filter((arg) => arg.startsWith('--upstream=')).length, 1);
    const caddy = docs.find((m) => m.kind === 'StatefulSet').spec.template.spec.containers.find((c) => c.name === 'caddy');
    assert.equal(caddy.image, 'docker.io/library/caddy:2.11.7-alpine');
    assert.equal(caddy.ports, undefined, 'Caddy must not expose a Pod-IP listener');
    const config = docs.find((m) => m.kind === 'ConfigMap' && m.metadata.name === 'memory-caddy').data.Caddyfile;
    assert.match(config, /reverse_proxy 127\.0\.0\.1:3113/);
  }
});
test('custom ClusterIP ports retain numeric targets and headless ports match the listener', () => {
  const modes = [
    { args: [], listener: 3111 },
    { args: ['-f', 'examples/oauth2-proxy.yaml', '-f', 'examples/oauth2-api.yaml'], listener: 4180 },
  ];
  for (const { args, listener } of modes) {
    const services = render([...auth, '--set', 'service.port=8080', ...args]).filter((m) => m.kind === 'Service');
    const primary = services.find((s) => !s.metadata.name.endsWith('-auth') && s.spec.clusterIP !== 'None');
    const headless = services.find((s) => s.spec.clusterIP === 'None');
    assert.equal(primary.spec.ports[0].port, 8080);
    assert.equal(primary.spec.ports[0].targetPort, listener);
    assert.equal(headless.spec.ports[0].port, listener);
    assert.equal(headless.spec.ports[0].targetPort, listener);
  }
});
test('stock Caddy stays behind authentication, rejects WebSocket upgrades and has no credentials', () => {
  const docs = render([...auth, '-f', 'examples/oauth2-proxy.yaml']);
  const sts = docs.find((m) => m.kind === 'StatefulSet');
  const caddy = sts.spec.template.spec.containers.find((c) => c.name === 'caddy');
  assert.deepEqual(caddy.command, ['caddy']);
  assert.equal(caddy.securityContext.readOnlyRootFilesystem, true);
  assert.equal(caddy.securityContext.allowPrivilegeEscalation, false);
  assert.deepEqual(caddy.securityContext.capabilities, { drop: ['ALL'], add: ['NET_BIND_SERVICE'] });
  assert.deepEqual(caddy.volumeMounts.map((m) => m.name), ['caddy-config', 'caddy-tmp']);
  assert.ok(caddy.env.every((e) => !e.valueFrom && !e.name.includes('SECRET')));
  assert.deepEqual(caddy.readinessProbe.exec.command, ['/bin/busybox', 'wget', '-q', '-O', '/dev/null', 'http://127.0.0.1:4181/healthz']);
  assert.match(sts.spec.template.metadata.annotations['checksum/caddy'], /^[a-f0-9]{64}$/);
  const config = docs.find((m) => m.kind === 'ConfigMap' && m.metadata.name === 'memory-caddy').data.Caddyfile;
  for (const text of ['admin off', 'persist_config off', 'auto_https off', 'bind 127.0.0.1',
    '@upgrade header Upgrade websocket', 'respond @upgrade 403',
    'header_up -Cookie', 'header_up -Authorization', 'reverse_proxy 127.0.0.1:3113']) assert.ok(config.includes(text), text);
  assert.ok(docs.filter((m) => m.kind === 'Service').every((s) => s.spec.ports.every((p) => p.targetPort !== 4181)));
  assert.ok(!render(auth).some((m) => m.kind === 'ConfigMap' && m.metadata.name.endsWith('-caddy')));
});
test('Caddy image and resources are configurable and unsafe public host input is rejected', () => {
  const docs = render([...auth, '-f', 'examples/oauth2-proxy.yaml', '--set', 'caddy.resources.limits.memory=256Mi',
    '--set', `caddy.image.digest=sha256:${'a'.repeat(64)}`]);
  const caddy = docs.find((m) => m.kind === 'StatefulSet').spec.template.spec.containers.find((c) => c.name === 'caddy');
  assert.equal(caddy.image, `docker.io/library/caddy@sha256:${'a'.repeat(64)}`);
  assert.equal(caddy.resources.limits.memory, '256Mi');
  assert.match(render([...auth, '-f', 'examples/oauth2-proxy.yaml', '--set-string', 'oauth2Proxy.uiHost=bad\nrespond 200'], false), /uiHost/);
  assert.match(render([...auth, '-f', 'examples/oauth2-proxy.yaml', '--set', 'caddy.image.tag='], false), /caddy.image/);
});
test('Entra, Keycloak, CSI identity/file mounts and resource overrides render', () => {
  for (const provider of ['entra', 'keycloak']) {
    const docs = render([...auth, '-f', 'examples/traefik-ingress.yaml', '-f', `examples/oidc-${provider}.yaml`]);
    const proxy = docs.find((m) => m.kind === 'StatefulSet').spec.template.spec.containers.find((c) => c.name === 'oauth2-proxy');
    assert.ok(proxy.args.includes(provider === 'entra' ? '--provider=oidc' : '--provider=keycloak-oidc'));
    assert.ok(proxy.args.includes('--scope=openid profile email'));
  }
  const docs = render(['-f', 'examples/csi-azure.yaml', '-f', 'examples/resources.yaml']);
  const pod = docs.find((m) => m.kind === 'StatefulSet').spec.template;
  assert.equal(pod.metadata.labels['azure.workload.identity/use'], 'true');
  assert.equal(pod.spec.serviceAccountName, 'agentmemory-keyvault');
  const sa = docs.find((m) => m.kind === 'ServiceAccount');
  assert.equal(sa.metadata.annotations['azure.workload.identity/client-id'], 'USER_ASSIGNED_CLIENT_ID');
  assert.equal(pod.spec.volumes.find((v) => v.name === 'keyvault-secrets').csi.driver, 'secrets-store.csi.k8s.io');
  const app = pod.spec.containers.find((c) => c.name === 'app');
  assert.equal(app.env.find((e) => e.name === 'AGENTMEMORY_SECRET_FILE').value, '/mnt/secrets-store/AGENTMEMORY_SECRET');
  assert.equal(app.resources.limits.memory, '4Gi');
  assert.ok(!pod.spec.initContainers[0].volumeMounts.some((v) => v.name === 'keyvault-secrets'));
  const spc = parse(readFileSync('examples/azure-secretproviderclass.yaml', 'utf8'));
  assert.equal(spc.metadata.namespace, 'agentmemory');
  assert.equal(spc.spec.parameters.clientID, sa.metadata.annotations['azure.workload.identity/client-id']);
  const objects = parse(spc.spec.parameters.objects).array.map(parse);
  assert.equal(objects[0].objectAlias, 'AGENTMEMORY_SECRET');
  assert.equal(objects[0].filePermission, '0444');
  const keycloak = parseAllDocuments(readFileSync('examples/keycloak-local.yaml', 'utf8')).map((d) => d.toJSON());
  assert.equal(keycloak[0].spec.template.spec.containers[0].env[1].valueFrom.secretKeyRef.name, 'keycloak-bootstrap');
  assert.equal(keycloak[2].spec.tls[0].hosts[0], 'identity.example.com');
});
test('full name override preserves existing resource identities', () => {
  const docs = render([...auth, '--set', 'fullnameOverride=agentmemory-kube-agentmemory']);
  const sts = docs.find((m) => m.kind === 'StatefulSet');
  assert.equal(sts.metadata.name, 'agentmemory-kube-agentmemory');
  assert.equal(sts.spec.serviceName, 'agentmemory-kube-agentmemory-headless');
});
test('refuses unauthenticated or incomplete routing configuration', () => {
  assert.match(render([], false), /Configure secrets/);
  assert.match(render([...auth, '--set', 'ingress.enabled=true'], false), /tlsSecretName/);
  assert.match(render([...auth, '--set', 'gateway.enabled=true'], false), /parentRefs/);
});
test('Vault uses raw files and a token volume isolated from application containers', () => {
  const manifests = render(['-f', 'examples/vault.yaml']);
  const pod = manifests.find((m) => m.kind === 'StatefulSet').spec.template;
  assert.match(pod.metadata.annotations['vault.hashicorp.com/agent-inject-template-AGENTMEMORY_SECRET'], /\{\{- with secret/);
  assert.equal(pod.metadata.annotations['vault.hashicorp.com/preserve-secret-case'], 'true');
  assert.equal(pod.metadata.annotations['vault.hashicorp.com/agent-inject-containers'], 'app');
  assert.equal(pod.spec.automountServiceAccountToken, false);
  assert.equal(pod.spec.volumes.find((v) => v.name === 'vault-token').projected.sources[0].serviceAccountToken.audience, 'vault');
  for (const container of [...pod.spec.containers, ...pod.spec.initContainers]) {
    assert.ok(!container.volumeMounts.some((m) => m.name === 'vault-token'));
  }
  const env = pod.spec.containers.find((c) => c.name === 'app').env;
  assert.equal(env.find((v) => v.name === 'AGENTMEMORY_SECRET_FILE').value, '/vault/secrets/AGENTMEMORY_SECRET');
});
test('Traefik ingress, gateway, mounted credentials, external provider and existing PVC render', () => {
  for (const file of ['local', 'traefik-ingress', 'traefik-gateway', 'mounted-secret', 'external-provider']) {
    const args = file === 'external-provider' ? ['-f', 'examples/vault.yaml'] : file === 'mounted-secret' ? [] : auth;
    render([...args, '-f', `examples/${file}.yaml`]);
  }
  const ingress = render([...auth, '-f', 'examples/traefik-ingress.yaml']).find((m) => m.kind === 'Ingress');
  assert.equal(ingress.spec.rules[0].http.paths[0].path, '/agentmemory');
  assert.equal(ingress.spec.tls[0].secretName, 'memory-tls');
  const sts = render([...auth, '--set', 'persistence.existingClaim=data']).find((m) => m.kind === 'StatefulSet');
  assert.equal(sts.spec.volumeClaimTemplates, undefined);
  assert.equal(sts.spec.template.spec.volumes.find((v) => v.name === 'data').persistentVolumeClaim.claimName, 'data');
});
test('OAuth sidecar routes UI/API through SSO, isolates backend listeners and supports Vault files', () => {
  assert.match(render([...auth, '--set', 'oauth2Proxy.enabled=true'], false), /issuerUrl/);
  const manifests = render([...auth, '-f', 'examples/traefik-ingress.yaml', '-f', 'examples/oauth2-proxy.yaml']);
  const pod = manifests.find((m) => m.kind === 'StatefulSet').spec.template.spec;
  const proxy = pod.containers.find((c) => c.name === 'oauth2-proxy');
  assert.ok(proxy.args.includes('--upstream=http://127.0.0.1:4181/'));
  assert.ok(proxy.args.includes('--cookie-secure=true'));
  assert.ok(proxy.args.includes('--code-challenge-method=S256'));
  assert.equal(proxy.env[0].valueFrom.secretKeyRef.name, 'agentmemory-oauth');
  assert.equal(proxy.resources.requests['ephemeral-storage'], '10Mi');
  assert.equal(proxy.resources.limits['ephemeral-storage'], '64Mi');
  const api = manifests.find((m) => m.kind === 'Ingress' && !m.metadata.name.endsWith('-ui'));
  assert.equal(api.spec.rules[0].http.paths[0].backend.service.port.number, 3111);
  const path = manifests.find((m) => m.kind === 'Ingress' && m.metadata.name.endsWith('-ui')).spec.rules[0].http.paths[0];
  assert.equal(path.path, '/');
  assert.equal(path.backend.service.port.number, 4180);
  const network = manifests.find((m) => m.kind === 'NetworkPolicy');
  assert.deepEqual(network.spec.ingress[0].ports.map((p) => p.port), [3111, 4180]);
  const vault = render(['-f', 'examples/vault.yaml', '-f', 'examples/oauth2-proxy.yaml', '-f', 'examples/oauth2-proxy-vault.yaml']);
  const annotations = vault.find((m) => m.kind === 'StatefulSet').spec.template.metadata.annotations;
  assert.match(annotations['vault.hashicorp.com/agent-inject-template-oauth2-cookie'], /base64Decode/);
  assert.equal(annotations['vault.hashicorp.com/agent-inject-containers'], 'app,oauth2-proxy');
  render([...auth, '-f', 'examples/traefik-gateway.yaml', '-f', 'examples/oauth2-proxy.yaml']);
  assert.match(render([...auth, '-f', 'examples/traefik-ingress.yaml', '-f', 'examples/oauth2-proxy.yaml',
    '--set', 'oauth2Proxy.uiHost=memory.example.com', '--set', 'oauth2Proxy.redirectUrl=https://memory.example.com/oauth2/callback'], false), /separate hostnames/);
});
