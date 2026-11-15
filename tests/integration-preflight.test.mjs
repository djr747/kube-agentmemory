import assert from 'node:assert/strict';
import test from 'node:test';
import { checkContainerRuntime } from './helpers/integration-preflight.mjs';

test('checks the Docker-compatible server before integration setup', () => {
  const calls = [];
  const version = checkContainerRuntime((...args) => {
    calls.push(args);
    return '5.7.1\n';
  });

  assert.equal(version, '5.7.1');
  assert.deepEqual(calls[0].slice(0, 2), ['docker', ['info', '--format', '{{.ServerVersion}}']]);
  assert.equal(calls[0][2].encoding, 'utf8');
});

test('gives actionable guidance when the container API is unavailable', () => {
  const cause = Object.assign(new Error('docker info failed'), {
    stderr: Buffer.from('Cannot connect to the Docker daemon'),
  });

  assert.throws(() => checkContainerRuntime(() => { throw cause; }), (error) => {
    assert.match(error.message, /Docker-compatible container API is not reachable/);
    assert.match(error.message, /Start Docker Engine or the Podman machine/);
    assert.match(error.message, /Cannot connect to the Docker daemon/);
    assert.equal(error.cause, cause);
    return true;
  });
});
