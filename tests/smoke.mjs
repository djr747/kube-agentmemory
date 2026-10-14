import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { loadSecrets } from '../runtime/secrets.mjs';

loadSecrets();
const base = process.env.TEST_URL || 'http://127.0.0.1:3111';
const stateFile = process.argv[3] || process.env.TEST_STATE || '/tmp/agentmemory-test.json';
const mode = process.argv[2] || 'write';
async function request(path, body, token = process.env.AGENTMEMORY_SECRET) {
  return fetch(`${base}/agentmemory/${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body && { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(180000),
  });
}
async function json(path, body) {
  const response = await request(path, body);
  assert.ok(response.ok, `${path}: HTTP ${response.status}`);
  return response.json();
}
assert.equal((await request('livez', undefined, '')).status, 200);
assert.equal((await request('remember', { content: 'unauthorized' }, '')).status, 401);
assert.equal((await request('search', { query: 'unauthorized' }, 'wrong-token')).status, 401);
assert.equal((await request('mcp/tools', undefined, '')).status, 401);
assert.ok((await json('mcp/tools')).tools.length > 0);
const flags = await json('config/flags');
assert.match(flags.embeddingProvider, /local/);
let state;
if (mode === 'write') {
  const marker = `helm-persistence-${Date.now()}`;
  const result = await json('remember', {
    content: `${marker} Kubernetes deployment retains memory on a persistent volume.`,
    type: 'fact', project: '/integration',
  });
  assert.equal(result.success, true);
  assert.ok(result.memory.id);
  state = { marker, id: result.memory.id };
  writeFileSync(stateFile, JSON.stringify(state));
} else {
  assert.equal(mode, 'read');
  state = JSON.parse(readFileSync(stateFile, 'utf8'));
}
// Embeddings run asynchronously on remember; require real vectors, not just BM25 fallback.
let vectorCount = 0;
let checkpointed = mode === 'read';
for (let attempt = 0; attempt < 120; attempt++) {
  const status = await json('status');
  vectorCount = status.index?.vectorDocuments ?? 0;
  if (mode === 'write') checkpointed = Boolean(status.indexPersistence?.vector?.lastSavedAt)
    && status.indexPersistence.pendingChanges === 0 && !status.indexPersistence.saving;
  if (vectorCount > 0 && checkpointed) break;
  await delay(2000);
}
assert.ok(vectorCount > 0, 'local embeddings must produce vector documents');
assert.ok(checkpointed, 'local vectors must reach a durable checkpoint before restart');
const search = await json('search', { query: state.marker, project: '/integration', limit: 10 });
assert.ok(JSON.stringify(search).includes(state.id), 'search must return the saved memory');
console.log(`${mode}: auth, MCP, local embeddings, and persisted memory passed`);
