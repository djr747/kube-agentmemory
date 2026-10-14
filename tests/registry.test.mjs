import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registryDigest } from './helpers/registry-digest.mjs';

test('release signing uses the index digest and rejects missing, malformed or ambiguous registry output', () => {
  const index = `sha256:${'a'.repeat(64)}`;
  const child = `sha256:${'b'.repeat(64)}`;
  assert.equal(registryDigest(`Name: ghcr.io/example/memory\nDigest: ${index}\nManifests:\n  Digest: ${child}\n`), index);
  assert.throws(() => registryDigest(`  Digest: ${child}\n`));
  assert.throws(() => registryDigest('Digest: sha256:incomplete\n'));
  assert.throws(() => registryDigest(`Digest: ${index}\nDigest: ${child}\n`));
});
