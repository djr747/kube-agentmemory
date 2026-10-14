import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { registryDigest } from './helpers/registry-digest.mjs';

const reference = process.argv[2];
assert.ok(reference, 'Provide the published candidate image reference');
const output = execFileSync('docker', ['buildx', 'imagetools', 'inspect', reference], { encoding: 'utf8' });
process.stdout.write(`${registryDigest(output)}\n`);
