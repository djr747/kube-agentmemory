import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';

const name = process.argv[2];
assert.ok(['caddy', 'oauth2Proxy'].includes(name), 'Choose a chart-managed external image');
const { repository, tag, digest } = parse(readFileSync('charts/kube-agentmemory/values.yaml', 'utf8'))[name].image;
const image = digest ? `${repository}@${digest}` : `${repository}:${tag}`;
assert.match(image, /^[a-zA-Z0-9./_-]+(?::[a-zA-Z0-9._-]+|@sha256:[a-f0-9]{64})$/);
console.log(image);
