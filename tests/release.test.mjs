import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolve } from 'node:path';
import { parse } from 'yaml';
import { releaseMetadata } from './helpers/release-metadata.mjs';
import { checkRelease, publishRelease } from './helpers/github-release.mjs';

test('version source, dependency lock, paired engine, chart and changelog agree', () => {
  const pkg = JSON.parse(readFileSync('package.json'));
  const lock = JSON.parse(readFileSync('package-lock.json'));
  const chart = parse(readFileSync('charts/kube-agentmemory/Chart.yaml', 'utf8'));
  assert.match(pkg.version, /^\d+\.\d+\.\d+$/);
  assert.equal(pkg.version, lock.version);
  assert.equal(pkg.version, lock.packages[''].version);
  assert.deepEqual(pkg.dependencies, lock.packages[''].dependencies);
  assert.deepEqual(pkg.devDependencies, lock.packages[''].devDependencies);
  assert.equal(chart.version, '0.0.0');
  assert.equal(chart.appVersion, '0.0.0');
  assert.ok(readFileSync('CHANGELOG.md', 'utf8').includes(`## [${pkg.version}]`));
  assert.equal(pkg.dependencies['@agentmemory/agentmemory'], lock.packages['node_modules/@agentmemory/agentmemory'].version);
  const engine = readFileSync('Dockerfile.engine', 'utf8').match(/FROM iiidev\/iii:([^ ]+) AS upstream/)[1];
  assert.equal(lock.packages['node_modules/iii-sdk'].version, engine);
  const dockerfile = readFileSync('Dockerfile', 'utf8');
  assert.match(dockerfile, /FROM gcr\.io\/distroless\/nodejs22-debian13:debug AS dependencies/);
  const tool = JSON.parse(readFileSync('build/npm/package.json'));
  const toolLock = JSON.parse(readFileSync('build/npm/package-lock.json'));
  assert.equal(tool.version, toolLock.version);
  assert.equal(tool.npmSource.version, tool.version);
  assert.deepEqual(tool.dependencies, toolLock.packages[''].dependencies);
  assert.match(tool.npmSource.integrity, /^sha512-/);
  for (const key of Object.keys(pkg.allowScripts)) {
    const separator = key.lastIndexOf('@');
    assert.equal(lock.packages[`node_modules/${key.slice(0, separator)}`].version, key.slice(separator + 1));
  }
  assert.match(dockerfile, /FROM gcr\.io\/distroless\/nodejs22-debian13:nonroot AS runtime/);
  assert.match(readFileSync('Dockerfile.engine', 'utf8'), /FROM gcr\.io\/distroless\/cc-debian13:nonroot/);
});
test('development chart refuses accidental release tags; packaged versions follow package.json', () => {
  const result = spawnSync('helm', ['template', 'memory', 'charts/kube-agentmemory', '--kube-version', '1.30.0',
    '--set', 'secrets.existingSecret=auth'], { encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Development chart requires image.tag/);
  const destination = mkdtempSync(join(tmpdir(), 'agentmemory-release-chart-'));
  try { execFileSync('node', ['tests/package-chart.mjs', destination], { stdio: 'pipe' }); }
  finally { rmSync(destination, { recursive: true, force: true }); }
});
test('upstream tags and notes are generated from locked release metadata', () => {
  const pkg = { version: '1.2.3', dependencies: { '@agentmemory/agentmemory': '0.9.30' } };
  const lock = { packages: { 'node_modules/iii-sdk': { version: '0.22.1' } } };
  const notes = '# Changelog\n\n## [1.2.3] - 2026-10-14\n\n- New feature.\n\n## [1.2.2] - 2026-10-13\n\n- Previous change.';
  const release = releaseMetadata(pkg, lock, notes);
  assert.equal(release.upstreamTag, '1.2.3-agentmemory0.9.30-iii0.22.1');
  assert.deepEqual(release.tags, ['1.2.3', '1.2', '1', release.upstreamTag, 'latest']);
  assert.equal(release.notes, '- New feature.');
  assert.throws(() => releaseMetadata({ ...pkg, version: '1.2.3-preview' }, lock, notes));
  assert.throws(() => releaseMetadata(pkg, lock, '# No notes'));
});
test('release sync updates derived versions and refuses a bump without release notes', () => {
  const directory = mkdtempSync(join(tmpdir(), 'agentmemory-release-sync-'));
  const script = resolve('tests/sync-release.mjs');
  try {
    const pkg = { version: '1.2.3', dependencies: { '@agentmemory/agentmemory': '0.9.30' } };
    const lock = { version: '1.2.2', packages: { '': { version: '1.2.2' }, 'node_modules/iii-sdk': { version: '0.22.1' } } };
    writeFileSync(join(directory, 'package.json'), JSON.stringify(pkg));
    writeFileSync(join(directory, 'package-lock.json'), JSON.stringify(lock));
    writeFileSync(join(directory, 'CHANGELOG.md'), '## [1.2.3] - 2026-10-14\n\n- Added feature.\n');
    execFileSync('node', [script], { cwd: directory });
    const synchronized = readFileSync(join(directory, 'package-lock.json'), 'utf8');
    assert.equal(JSON.parse(synchronized).version, '1.2.3');
    assert.equal(JSON.parse(synchronized).packages[''].version, '1.2.3');
    pkg.version = '1.2.4';
    writeFileSync(join(directory, 'package.json'), JSON.stringify(pkg));
    assert.notEqual(spawnSync('node', [script], { cwd: directory }).status, 0);
    assert.equal(readFileSync(join(directory, 'package-lock.json'), 'utf8'), synchronized);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
test('publishing is gated on successful main push CI and reuses tested archives', () => {
  const ci = parse(readFileSync('.github/workflows/ci.yml', 'utf8'));
  const release = parse(readFileSync('.github/workflows/release.yml', 'utf8'));
  const condition = "github.event_name == 'push' && github.ref == 'refs/heads/main'";
  assert.deepEqual(ci.on.push.branches, ['main', 'develop']);
  assert.equal(ci.on.push.tags, undefined);
  assert.equal(ci.jobs.release.if, condition);
  assert.deepEqual(ci.jobs.release.needs, ['validate', 'container']);
  assert.equal(ci.jobs.release.uses, './.github/workflows/release.yml');
  assert.ok(ci.jobs.container.steps.some((s) => s.with?.name === 'chart' && s.with.path === 'dist'));
  assert.equal(ci.jobs.container.steps.find((s) => s.name === 'Test packaged chart with local embeddings').env.CHART_ARCHIVE_DIR, 'dist');
  assert.deepEqual(Object.keys(release.on), ['workflow_call']);
  assert.equal(release.jobs.prepare.if, condition);
  for (const job of [release.jobs.images, release.jobs.artifacts]) {
    assert.equal(job.if, `${condition} && needs.prepare.outputs.already_published != 'true'`);
  }
  const preflight = release.jobs.prepare.steps.find((s) => s.id === 'preflight');
  assert.equal(preflight.run, 'node tests/publish-release.mjs --check');
  assert.equal(preflight.env.GH_TOKEN, '${{ github.token }}');
  assert.equal(release.jobs.prepare.outputs.already_published, '${{ steps.preflight.outputs.already_published }}');
  assert.deepEqual(release.jobs.artifacts.needs, ['prepare', 'images']);
  assert.ok(release.jobs.images.steps.some((s) => s.with?.name === 'candidate-${{ matrix.arch }}'));
  const publication = release.jobs.artifacts.steps.at(-1).run;
  assert.match(publication, /helm push/);
  assert.match(publication, /node tests\/publish-release\.mjs/);
  assert.doesNotMatch(publication, /docker (?:build\b|buildx build\b)|pr merge/);
  const steps = release.jobs.artifacts.steps;
  const signing = steps.findIndex((s) => s.name === 'Sign tested image indexes and attest architecture SBOMs');
  const aliasing = steps.findIndex((s) => s.name === 'Publish image aliases, OCI chart and GitHub release');
  assert.ok(signing > 0 && aliasing > signing);
  assert.match(steps[signing].run, /cosign sign --yes/);
  assert.match(steps[signing].run, /cosign attest --yes --type spdxjson/);
  assert.equal(steps.filter((s) => s.uses?.startsWith('actions/attest-build-provenance@')).length, 3);
  assert.equal(release.jobs.artifacts.permissions['id-token'], 'write');
  assert.equal(release.jobs.artifacts.permissions.attestations, 'write');
  assert.equal(ci.jobs.release.permissions['id-token'], 'write');
});

const releaseContext = { tag: 'v1.2.3', revision: 'a'.repeat(40) };
const releaseAssets = ['chart.tgz', 'sbom.json', 'provenance.json'];
function fakeReleaseApi() {
  const state = { ref: null, target: null, release: null, assets: [], calls: [], fail: null };
  const api = {
    readTag: () => state.ref,
    readTagObject: () => ({ object: state.target }),
    readRelease: () => state.release,
    createTag(tag, revision) {
      state.calls.push('tag');
      state.ref = { type: 'tag', sha: 'b'.repeat(40) };
      state.target = { type: 'commit', sha: revision };
      if (state.fail === 'tag') throw new Error('Tag response lost');
    },
    createDraft() {
      state.calls.push('draft');
      state.release = { draft: true };
      if (state.fail === 'draft') throw new Error('Draft response lost');
    },
    uploadAssets(tag, assets) {
      assert.equal(state.release.draft, true);
      state.calls.push('upload');
      state.assets = state.fail === 'upload' ? assets.slice(0, 1) : [...assets];
      if (state.fail === 'upload') throw new Error('Partial asset upload');
    },
    publishDraft() {
      assert.deepEqual(state.assets, releaseAssets);
      state.calls.push('publish');
      state.release.draft = false;
      if (state.fail === 'publish') throw new Error('Publish response lost');
    },
  };
  return { state, api };
}
for (const failure of ['tag', 'draft', 'upload']) {
  test(`release retries recover from a failed ${failure} without recreating its tag or publishing missing assets`, () => {
    const { api, state } = fakeReleaseApi();
    state.fail = failure;
    assert.throws(() => publishRelease(api, releaseContext, releaseAssets));
    assert.equal(checkRelease(api, releaseContext).published, false);
    state.fail = null;
    assert.equal(publishRelease(api, releaseContext, releaseAssets), 'published');
    assert.equal(state.calls.filter((call) => call === 'tag').length, 1);
    assert.equal(state.calls.filter((call) => call === 'draft').length, 1);
    assert.deepEqual(state.assets, releaseAssets);
    assert.equal(state.release.draft, false);
  });
}
test('published matching release is left untouched, including after a lost publish response', () => {
  const { api, state } = fakeReleaseApi();
  state.fail = 'publish';
  assert.throws(() => publishRelease(api, releaseContext, releaseAssets));
  assert.equal(checkRelease(api, releaseContext).published, true);
  const calls = [...state.calls];
  assert.equal(publishRelease(api, releaseContext, releaseAssets), 'already-published');
  assert.deepEqual(state.calls, calls);
});
test('a release version targeting other source, a lightweight tag or an orphaned release fails before mutation', () => {
  const { api, state } = fakeReleaseApi();
  api.createTag(releaseContext.tag, 'c'.repeat(40));
  state.calls = [];
  assert.throws(() => publishRelease(api, releaseContext, releaseAssets), /tested commit/);
  state.ref.type = 'commit';
  state.ref.sha = releaseContext.revision;
  assert.throws(() => publishRelease(api, releaseContext, releaseAssets), /annotated/);
  state.ref = null;
  state.release = { draft: false };
  assert.throws(() => publishRelease(api, releaseContext, releaseAssets), /no verified tag/);
  assert.deepEqual(state.calls, []);
});
test('release lookup failures stop publication before any mutation', () => {
  const { api, state } = fakeReleaseApi();
  api.readRelease = () => { throw new Error('GitHub unavailable'); };
  assert.throws(() => publishRelease(api, releaseContext, releaseAssets), /GitHub unavailable/);
  assert.deepEqual(state.calls, []);
});
test('release CLI refuses PR and develop contexts before contacting GitHub', () => {
  for (const [event, ref] of [['pull_request', 'refs/pull/1/merge'], ['push', 'refs/heads/develop']]) {
    const result = spawnSync('node', ['tests/publish-release.mjs'], {
      encoding: 'utf8', env: { ...process.env, GITHUB_EVENT_NAME: event, GITHUB_REF: ref },
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Release operations require a main push/);
  }
});
