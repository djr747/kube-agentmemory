import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { releaseMetadata } from './helpers/release-metadata.mjs';
import assert from 'node:assert/strict';

const pkg = JSON.parse(readFileSync('package.json'));
const lock = JSON.parse(readFileSync('package-lock.json'));
assert.equal(lock.version, pkg.version, 'Run make release-sync after updating the version and changelog');
assert.equal(lock.packages[''].version, pkg.version);
const release = releaseMetadata(pkg, lock, readFileSync('CHANGELOG.md', 'utf8'));
writeFileSync('release-notes.md', `${release.notes}\n\nUpstream agentmemory ${release.agentmemory}; iii ${release.iii}.\n`);
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT,
  `version=${release.version}\nupstream_tag=${release.upstreamTag}\ntags=${release.tags.join(',')}\n`);
console.log(`Release ${release.version}, upstream tag ${release.upstreamTag}`);
