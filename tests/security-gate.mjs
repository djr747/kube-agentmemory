import { readFileSync, appendFileSync } from 'node:fs';
import { evaluateScan } from './helpers/scan-policy.mjs';

if (process.argv.length < 3) throw new Error('Provide application and engine Grype JSON reports');
let blocked = false;
for (const path of process.argv.slice(2)) {
  const result = evaluateScan(JSON.parse(readFileSync(path, 'utf8')));
  const heading = `${path}: ${result.all.length} total findings, ${result.blocking.length} blocking high/critical with a known fix, ${result.unfixed.length} high/critical without a known fix`;
  console.log(heading);
  const lines = result.high.map((match) => {
    const { vulnerability, artifact } = match;
    const { state, versions } = vulnerability.fix;
    const fix = state === 'fixed' && versions.length ? `fixed in ${versions.join(', ')}` : state;
    const text = `${vulnerability.id} ${artifact.name}@${artifact.version}: ${fix}`;
    console.log(text);
    return `- ${text.replace(/[\r\n`]/g, ' ')} (${vulnerability.dataSource})`;
  });
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `\n${heading}\n\n${lines.join('\n')}\n`);
  if (result.blocking.length) blocked = true;
}
if (blocked) process.exitCode = 1;
