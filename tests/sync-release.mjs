import { readFileSync, writeFileSync } from 'node:fs';
import { releaseMetadata } from './helpers/release-metadata.mjs';

const pkg = JSON.parse(readFileSync('package.json'));
const lock = JSON.parse(readFileSync('package-lock.json'));
releaseMetadata(pkg, lock, readFileSync('CHANGELOG.md', 'utf8'));
lock.version = pkg.version;
lock.packages[''].version = pkg.version;
writeFileSync('package-lock.json', `${JSON.stringify(lock, null, 2)}\n`);
console.log(`Synchronized release ${pkg.version}; chart versions are generated at packaging`);
