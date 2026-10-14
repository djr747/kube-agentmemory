import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

test('bootstrap rejects caller-controlled paths without reading or changing them', () => {
  const victim = mkdtempSync(join(tmpdir(), 'agentmemory-bootstrap-victim-'));
  const marker = join(victim, 'credential');
  writeFileSync(marker, 'private-credential-must-not-be-read-or-deleted');
  try {
    for (const args of [[victim, victim], ['--ci', victim], ['../../credential']]) {
      const result = spawnSync(process.execPath, ['build/bootstrap-npm.mjs', ...args], { encoding: 'utf8' });
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /Only --ci is supported/);
      assert.ok(!`${result.stdout}${result.stderr}`.includes(readFileSync(marker, 'utf8')));
      assert.equal(readFileSync(marker, 'utf8'), 'private-credential-must-not-be-read-or-deleted');
    }
  } finally { rmSync(victim, { recursive: true, force: true }); }
});

test('bootstrap refuses symlinked build destinations before deleting any dependency tree', () => {
  const root = mkdtempSync(join(tmpdir(), 'agentmemory-bootstrap-root-'));
  const victim = mkdtempSync(join(tmpdir(), 'agentmemory-bootstrap-victim-'));
  mkdirSync(join(victim, 'node_modules'));
  const marker = join(victim, 'node_modules', 'keep');
  writeFileSync(marker, 'keep');
  try {
    mkdirSync(join(root, 'build', 'npm'), { recursive: true });
    for (const name of ['package.json', 'package-lock.json']) {
      copyFileSync(resolve('build', 'npm', name), join(root, 'build', 'npm', name));
    }
    copyFileSync(resolve('build/bootstrap-npm.mjs'), join(root, 'build/bootstrap-npm.mjs'));
    symlinkSync(victim, join(root, '.build-tools'));
    const result = spawnSync(process.execPath, [join(root, 'build/bootstrap-npm.mjs'), '--ci'], { encoding: 'utf8' });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /must not be a symlink/);
    assert.equal(readFileSync(marker, 'utf8'), 'keep');
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(victim, { recursive: true, force: true });
  }
});

test('bootstrap rejects unsupported npm dependency ranges before replacing its verified vendor bundle', () => {
  const root = mkdtempSync(join(tmpdir(), 'agentmemory-bootstrap-vendor-'));
  try {
    const pkg = JSON.parse(readFileSync('build/npm/package.json', 'utf8'));
    const lock = JSON.parse(readFileSync('build/npm/package-lock.json', 'utf8'));
    const source = join(root, 'source', 'package');
    mkdirSync(join(source, 'node_modules'), { recursive: true });
    writeFileSync(join(source, 'package.json'), JSON.stringify({ version: pkg.version, dependencies: pkg.dependencies }));
    writeFileSync(join(source, 'node_modules', 'keep'), 'verified vendor bundle');
    const archive = join(root, 'source.tgz');
    execFileSync('tar', ['-czf', archive, '-C', join(root, 'source'), 'package']);
    pkg.npmSource.integrity = `sha512-${createHash('sha512').update(readFileSync(archive)).digest('base64')}`;
    pkg.dependencies.chalk = '^6.0.1';
    lock.packages[''].dependencies = pkg.dependencies;
    mkdirSync(join(root, 'build', 'npm'), { recursive: true });
    writeFileSync(join(root, 'build', 'npm', 'package.json'), JSON.stringify(pkg));
    writeFileSync(join(root, 'build', 'npm', 'package-lock.json'), JSON.stringify(lock));
    copyFileSync(resolve('build/bootstrap-npm.mjs'), join(root, 'build', 'bootstrap-npm.mjs'));
    const loader = join(root, 'mock-download.mjs');
    writeFileSync(loader, `import { readFileSync } from 'node:fs';\nglobalThis.fetch = async () => new Response(readFileSync(new URL('./source.tgz', import.meta.url)));\n`);
    const result = spawnSync(process.execPath, ['--import', loader, join(root, 'build', 'bootstrap-npm.mjs'), '--ci'], { encoding: 'utf8' });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /npm dependency ranges must match verified source/);
    assert.equal(readFileSync(join(root, '.build-tools', 'npm', 'node_modules', 'keep'), 'utf8'), 'verified vendor bundle');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
