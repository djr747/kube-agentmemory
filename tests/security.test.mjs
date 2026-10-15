import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { evaluateScan } from './helpers/scan-policy.mjs';

const match = (severity, versions = [], state = 'not-fixed') => ({
  artifact: { name: 'library' }, vulnerability: { severity, fix: { versions, state } },
});
const metadata = { descriptor: { name: 'grype', db: { status: { valid: true } } }, source: { type: 'image' } };
test('reports all findings and blocks only high/critical findings with published fixes', () => {
  const report = { ...metadata, matches: [
    match('High', ['2.0'], 'fixed'), match('Critical'), match('High', [], 'wont-fix'), match('Medium', ['2.0'], 'fixed'),
  ] };
  const result = evaluateScan(report);
  assert.equal(result.all.length, 4);
  assert.equal(result.high.length, 3);
  assert.equal(result.blocking.length, 1);
  assert.equal(result.unfixed.length, 2);
  assert.equal(evaluateScan({ ...metadata, matches: [] }).blocking.length, 0);
});
test('fails closed when scanner or fix metadata is missing', () => {
  assert.throws(() => evaluateScan({}), /valid Grype/);
  assert.throws(() => evaluateScan({ ...metadata, matches: [{}] }), /Malformed/);
  assert.throws(() => evaluateScan({ ...metadata, matches: [{ artifact: {}, vulnerability: { severity: 'High' } }] }), /Missing fix/);
  assert.throws(() => evaluateScan({ ...metadata, matches: [match('Unexpected')] }), /Unrecognized/);
});
test('CI and local image scans cover only the application and engine built here', () => {
  const ci = parse(readFileSync('.github/workflows/ci.yml', 'utf8'));
  const steps = ci.jobs.container.steps;
  const scans = steps.filter((step) => step.uses?.startsWith('anchore/scan-action@'));
  assert.deepEqual(scans.map((step) => step.with.image), ['kube-agentmemory:ci', 'kube-agentmemory-engine:ci']);
  assert.equal(steps.find((step) => step.name === 'Enforce fixable high/critical vulnerability policy').run,
    'node tests/security-gate.mjs grype-app.json grype-engine.json');
  const makefile = readFileSync('Makefile', 'utf8');
  assert.deepEqual([...makefile.matchAll(/^\t\$\(GRYPE\)\s+(\S+)/gm)].map((match) => match[1]),
    ['docker:$(IMAGE)', 'docker:$(ENGINE_IMAGE)']);
  assert.match(makefile, /node tests\/security-gate\.mjs test-results\/grype-app\.json test-results\/grype-engine\.json\n/);
});
