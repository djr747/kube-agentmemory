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
test('single writer, retained storage, restricted containers and private engine ports', () => {
  const manifests = render(auth);
  const sts = manifests.find((m) => m.kind === 'StatefulSet');
  assert.equal(sts.spec.replicas, 1);
  assert.equal(sts.spec.persistentVolumeClaimRetentionPolicy.whenDeleted, 'Retain');
  assert.equal(sts.spec.template.spec.automountServiceAccountToken, false);
  assert.equal(sts.spec.template.spec.securityContext.runAsNonRoot, true);
  assert.equal(sts.spec.template.spec.initContainers[0].restartPolicy, 'Always');
  assert.equal(sts.spec.template.spec.initContainers[0].lifecycle.preStop.sleep.seconds, 5);
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
  const config = manifests.find((m) => m.kind === 'ConfigMap').data['config.yaml'];
  assert.match(config, /iii-worker-manager\n\s+config:\n\s+host: 127.0.0.1/);
  const net = manifests.find((m) => m.kind === 'NetworkPolicy');
  assert.deepEqual(net.spec.policyTypes, ['Ingress', 'Egress']);
  assert.deepEqual(net.spec.ingress[0].ports, [{ protocol: 'TCP', port: 3111 }]);
});
test('API OIDC is opt-in, removes direct ingress and changes both Service targets', () => {
  assert.match(render([...auth, '--set', 'oauth2Proxy.protectApi=true'], false), /requires oauth2Proxy.enabled/);
  for (const route of ['traefik-ingress', 'traefik-gateway']) {
    const docs = render([...auth, '-f', `examples/${route}.yaml`, '-f', 'examples/oauth2-proxy.yaml', '-f', 'examples/oauth2-api.yaml']);
    for (const service of docs.filter((m) => m.kind === 'Service')) {
      assert.ok(service.spec.ports.every((port) => port.targetPort === 4180));
    }
    assert.deepEqual(docs.find((m) => m.kind === 'NetworkPolicy').spec.ingress[0].ports, [{ protocol: 'TCP', port: 4180 }]);
    const proxy = docs.find((m) => m.kind === 'StatefulSet').spec.template.spec.containers.find((c) => c.name === 'oauth2-proxy');
    assert.ok(proxy.args.includes('--skip-jwt-bearer-tokens=true'));
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
test('refuses unauthenticated or incomplete routing configuration', () => {
  assert.match(render([], false), /Configure secrets/);
  assert.match(render([...auth, '--set', 'ingress.enabled=true'], false), /tlsSecretName/);
  assert.match(render([...auth, '--set', 'gateway.enabled=true'], false), /parentRefs/);
});
test('Vault uses raw files and a token volume isolated from application containers', () => {
  const manifests = render(['-f', 'examples/vault.yaml']);
  const pod = manifests.find((m) => m.kind === 'StatefulSet').spec.template;
  assert.match(pod.metadata.annotations['vault.hashicorp.com/agent-inject-template-AGENTMEMORY_SECRET'], /\{\{- with secret/);
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
  assert.ok(proxy.args.includes('--upstream=http://127.0.0.1:3113'));
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
