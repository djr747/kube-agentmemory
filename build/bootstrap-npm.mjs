// Install verified npm CLI source plus its separately audited, unbundled dependency tree.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, rmSync, mkdtempSync, chmodSync, lstatSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Select a fixed build location; callers cannot supply manifest or deletion paths.
const ci = process.argv[2] === '--ci';
assert.deepEqual(process.argv.slice(2), ci ? ['--ci'] : [], 'Only --ci is supported');
const npmRoot = ci ? fileURLToPath(new URL('../.build-tools/npm', import.meta.url)) : '/opt/npm';
const tar = ci ? 'tar' : '/busybox/tar';
const pkg = JSON.parse(readFileSync(new URL('./npm/package.json', import.meta.url)));
const lock = JSON.parse(readFileSync(new URL('./npm/package-lock.json', import.meta.url)));
assert.equal(lock.version, pkg.version);
assert.deepEqual(lock.packages[''].dependencies, pkg.dependencies);
assert.equal(pkg.npmSource.version, pkg.version);
assert.equal(pkg.npmSource.resolved, `https://registry.npmjs.org/npm/-/npm-${pkg.version}.tgz`);
if (ci) {
  const toolsRoot = dirname(npmRoot);
  mkdirSync(toolsRoot, { recursive: true, mode: 0o700 });
  assert.ok(!lstatSync(toolsRoot).isSymbolicLink(), 'Build tool parent must not be a symlink');
}
mkdirSync(npmRoot, { recursive: true, mode: 0o700 });
assert.ok(!lstatSync(npmRoot).isSymbolicLink(), 'Build tool directory must not be a symlink');
chmodSync(npmRoot, 0o700);
async function extract(entry, target) {
  assert.match(entry.resolved, /^https:\/\/registry\.npmjs\.org\//);
  assert.match(entry.integrity, /^sha512-[A-Za-z0-9+/]+={0,2}$/);
  const response = await fetch(entry.resolved, { signal: AbortSignal.timeout(120000) });
  assert.ok(response.ok, `Package download failed: ${response.status}`);
  const archive = Buffer.from(await response.arrayBuffer());
  assert.equal(`sha512-${createHash('sha512').update(archive).digest('base64')}`, entry.integrity,
    'Package archive integrity does not match the dependency lock');
  const temp = mkdtempSync(join(npmRoot, '.archive-'));
  try {
    mkdirSync(target, { recursive: true });
    writeFileSync(`${temp}/package.tgz`, archive);
    execFileSync(tar, ['-xzf', `${temp}/package.tgz`, '-C', target, '--strip-components', '1']);
  } finally { rmSync(temp, { recursive: true, force: true }); }
}
await extract(pkg.npmSource, npmRoot);
// Vendor bundles cannot be patched by npm audit fix. Use the complete locked tree instead.
rmSync(`${npmRoot}/node_modules`, { recursive: true, force: true });
const entries = Object.entries(lock.packages).filter(([path]) => path);
async function installNext() {
  const next = entries.shift();
  if (!next) return;
  const [path, entry] = next;
  assert.match(path, /^node_modules\//);
  assert.ok(!path.split('/').some((part) => part === '.' || part === '..'));
  const target = resolve(npmRoot, path);
  assert.ok(target.startsWith(`${npmRoot}/node_modules/`));
  await extract(entry, target);
  return installNext();
}
await Promise.all(Array.from({ length: 8 }, installNext));
console.log('Verified build-only npm source and locked dependencies');
