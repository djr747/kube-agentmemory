import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

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
