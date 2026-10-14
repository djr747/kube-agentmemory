// Install verified npm CLI source plus its separately audited, unbundled dependency tree.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, rmSync, mkdtempSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

const toolRoot = resolve(process.argv[2] || '/build/npm');
const npmRoot = resolve(process.argv[3] || '/opt/npm');
const tar = process.env.NPM_BOOTSTRAP_TAR || '/busybox/tar';
const pkg = JSON.parse(readFileSync(`${toolRoot}/package.json`));
const lock = JSON.parse(readFileSync(`${toolRoot}/package-lock.json`));
assert.equal(lock.version, pkg.version);
assert.deepEqual(lock.packages[''].dependencies, pkg.dependencies);
assert.equal(pkg.npmSource.version, pkg.version);
assert.equal(pkg.npmSource.resolved, `https://registry.npmjs.org/npm/-/npm-${pkg.version}.tgz`);
async function extract(entry, target) {
  assert.match(entry.resolved, /^https:\/\/registry\.npmjs\.org\//);
  assert.match(entry.integrity, /^sha512-[A-Za-z0-9+/]+={0,2}$/);
  const response = await fetch(entry.resolved, { signal: AbortSignal.timeout(120000) });
  assert.ok(response.ok, `Package download failed: ${response.status}`);
  const archive = Buffer.from(await response.arrayBuffer());
  assert.equal(`sha512-${createHash('sha512').update(archive).digest('base64')}`, entry.integrity,
    'Package archive integrity does not match the dependency lock');
  const temp = mkdtempSync('/tmp/npm-archive-');
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
for (let offset = 0; offset < entries.length; offset += 8) {
  await Promise.all(entries.slice(offset, offset + 8).map(async ([path, entry]) => {
    assert.match(path, /^node_modules\//);
    const target = resolve(npmRoot, path);
    assert.ok(target.startsWith(`${npmRoot}/node_modules/`));
    await extract(entry, target);
  }));
}
console.log(`Verified build-only npm ${pkg.version} and ${entries.length} locked dependencies`);
