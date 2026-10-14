import assert from 'node:assert/strict';

export function registryDigest(output) {
  const matches = [...output.matchAll(/^Digest:[ \t]+(sha256:[a-f0-9]{64})[ \t]*\r?$/gm)];
  assert.equal(matches.length, 1, 'Registry inspection must return one valid top-level digest');
  return matches[0][1];
}
