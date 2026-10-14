import assert from 'node:assert/strict';
import { readFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve, join } from 'node:path';
import { parse, parseAllDocuments } from 'yaml';

const version = JSON.parse(readFileSync('package.json')).version;
assert.match(version, /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/);
const destination = resolve(process.argv[2] || 'dist');
mkdirSync(destination, { recursive: true });
execFileSync('helm', ['package', 'charts/kube-agentmemory', '--version', version, '--app-version', version,
  '--destination', destination], { stdio: 'inherit' });
const archive = join(destination, `kube-agentmemory-${version}.tgz`);
const metadata = parse(execFileSync('helm', ['show', 'chart', archive], { encoding: 'utf8' }));
assert.equal(metadata.version, version);
assert.equal(metadata.appVersion, version);
const rendered = execFileSync('helm', ['template', 'memory', archive, '--kube-version', '1.30.0',
  '--set', 'secrets.existingSecret=auth'], { encoding: 'utf8' });
const pod = parseAllDocuments(rendered).map((d) => d.toJSON()).find((d) => d?.kind === 'StatefulSet').spec.template.spec;
assert.equal(pod.containers.find((c) => c.name === 'app').image, `ghcr.io/djr747/kube-agentmemory:${version}`);
assert.equal(pod.initContainers.find((c) => c.name === 'engine').image, `ghcr.io/djr747/kube-agentmemory-engine:${version}`);
console.log(`Verified release chart ${version} and both default image tags`);
