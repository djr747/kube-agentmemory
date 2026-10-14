import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSecrets } from '../runtime/secrets.mjs';

const token = 'test-token-with-at-least-32-characters';
test('accepts environment credentials and requires authentication', () => {
  assert.equal(loadSecrets({ AGENTMEMORY_SECRET: token }).AGENTMEMORY_SECRET, token);
  assert.throws(() => loadSecrets({}), /at least 32/);
  assert.throws(() => loadSecrets({ AGENTMEMORY_SECRET: 'short' }), /at least 32/);
});
test('reads credential files without evaluating shell syntax', () => {
  const env = { AGENTMEMORY_SECRET_FILE: '/vault/secrets/token', OPENAI_API_KEY_FILE: '/vault/secrets/key' };
  const read = (path) => path.endsWith('token') ? `${token}\n` : '$(touch /tmp/not-executed)\n';
  loadSecrets(env, read);
  assert.equal(env.AGENTMEMORY_SECRET, token);
  assert.equal(env.OPENAI_API_KEY, '$(touch /tmp/not-executed)');
});
test('rejects ambiguous, empty, and unreadable credential sources without disclosure', () => {
  assert.throws(() => loadSecrets({ AGENTMEMORY_SECRET: token, AGENTMEMORY_SECRET_FILE: '/secret' }), /Set only/);
  assert.throws(() => loadSecrets({ AGENTMEMORY_SECRET_FILE: '/secret' }, () => ''), /Empty credential/);
  assert.throws(() => loadSecrets({ AGENTMEMORY_SECRET_FILE: '/secret' }, () => { throw new Error(token); }),
    (error) => !error.message.includes(token) && error.message.includes('Cannot read'));
});
test('dotenv credentials respect environment and file precedence', () => {
  const env = { AGENTMEMORY_ENV_FILE: '/vault/secrets/env', AGENTMEMORY_SECRET: token, OPENAI_API_KEY_FILE: '/key' };
  loadSecrets(env, (path) => path === '/key' ? 'file-key\n' : 'AGENTMEMORY_SECRET=ignored\nOPENAI_API_KEY=ignored\n');
  assert.equal(env.AGENTMEMORY_SECRET, token);
  assert.equal(env.OPENAI_API_KEY, 'file-key');
  assert.throws(() => loadSecrets({ AGENTMEMORY_ENV_FILE: '/env' }, () => 'NODE_OPTIONS=--inspect'), /Unsupported credential/);
  assert.equal(loadSecrets({ AGENTMEMORY_ENV_FILE: '/env' }, () => `AGENTMEMORY_SECRET=${token}`).AGENTMEMORY_SECRET, token);
  assert.throws(() => loadSecrets({ AGENTMEMORY_ENV_FILE: '/env' }, () => { throw new Error('private'); }), /Cannot read AGENTMEMORY_ENV_FILE/);
});
