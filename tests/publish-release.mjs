import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import { checkRelease, publishRelease } from './helpers/github-release.mjs';

const { GITHUB_EVENT_NAME, GITHUB_REF, GITHUB_REPOSITORY, GITHUB_SHA, GITHUB_OUTPUT } = process.env;
if (GITHUB_EVENT_NAME !== 'push' || GITHUB_REF !== 'refs/heads/main') {
  throw new Error('Release operations require a main push');
}
if (!/^[\w.-]+\/[\w.-]+$/.test(GITHUB_REPOSITORY ?? '') || !/^[a-f0-9]{40}$/.test(GITHUB_SHA ?? '')) {
  throw new Error('Invalid release repository or tested revision');
}
const { version } = JSON.parse(readFileSync('package.json', 'utf8'));
if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Release requires a stable version');
const args = process.argv.slice(2);
if (args.length && (args.length !== 1 || args[0] !== '--check')) throw new Error('Only --check is supported');
const context = { tag: `v${version}`, revision: GITHUB_SHA };
const gh = (arguments_, input) => execFileSync('gh', arguments_, { encoding: 'utf8', input, stdio: ['pipe', 'pipe', 'pipe'] });
function read(endpoint) {
  try { return JSON.parse(gh(['api', `repos/${GITHUB_REPOSITORY}/${endpoint}`])); }
  catch (error) {
    if (/\(HTTP 404\)/.test(String(error.stderr))) return null;
    throw new Error('GitHub release lookup failed', { cause: error });
  }
}
const post = (endpoint, body) => JSON.parse(gh(['api', `repos/${GITHUB_REPOSITORY}/${endpoint}`, '--method', 'POST', '--input', '-'], JSON.stringify(body)));
const notes = ['--title', `Release v${version}`, '--notes-file', 'release-notes.md'];
const repository = ['--repo', GITHUB_REPOSITORY];
const api = {
  readTag: (tag) => read(`git/ref/tags/${tag}`)?.object,
  readTagObject: (sha) => read(`git/tags/${sha}`),
  readRelease: (tag) => read(`releases/tags/${tag}`),
  createTag(tag, revision) {
    const object = post('git/tags', { tag, message: `Release ${tag}`, object: revision, type: 'commit' });
    post('git/refs', { ref: `refs/tags/${tag}`, sha: object.sha });
  },
  createDraft: (tag) => gh(['release', 'create', tag, ...repository, '--draft', '--verify-tag', ...notes]),
  uploadAssets: (tag, assets) => gh(['release', 'upload', tag, ...repository, ...assets, '--clobber']),
  publishDraft: (tag) => gh(['release', 'edit', tag, ...repository, '--draft=false', '--verify-tag', ...notes]),
};

if (args[0] === '--check') {
  const { published } = checkRelease(api, context);
  if (GITHUB_OUTPUT) appendFileSync(GITHUB_OUTPUT, `already_published=${published}\n`);
  console.log(published ? 'Matching release already published; publication will be skipped' : 'Release preflight passed');
} else {
  const assets = [
    `dist/kube-agentmemory-${version}.tgz`,
    'release-assets/app-provenance.json', 'release-assets/engine-provenance.json', 'release-assets/chart-provenance.json',
    'release-assets/app-amd64.spdx.json', 'release-assets/app-arm64.spdx.json',
    'release-assets/engine-amd64.spdx.json', 'release-assets/engine-arm64.spdx.json',
  ];
  console.log(publishRelease(api, context, assets));
}
