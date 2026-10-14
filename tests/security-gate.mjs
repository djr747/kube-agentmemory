import { readFileSync, appendFileSync } from 'node:fs';
import { evaluateScan } from './helpers/scan-policy.mjs';

if (process.argv.length < 3) throw new Error('Provide application and engine Grype JSON reports');
let blocked = false;
for (const path of process.argv.slice(2)) {
  const result = evaluateScan(JSON.parse(readFileSync(path, 'utf8')));
  const heading = `${path}: ${result.all.length} total findings; ${result.blocking.length} fixable high/critical; ${result.unfixed.length} unfixed high/critical`;
  console.log(heading);
  const lines = result.high.map((match) => {
    const { vulnerability, artifact } = match;
    const text = `${vulnerability.id} ${artifact.name}@${artifact.version}: ${vulnerability.fix.versions.length ? `fixed in ${vulnerability.fix.versions.join(', ')}` : vulnerability.fix.state}`;
    console.log(text);
    return `- ${text.replace(/[\r\n`]/g, ' ')} (${vulnerability.dataSource})`;
  });
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `\n${heading}\n\n${lines.join('\n')}\n`);
  if (result.blocking.length) blocked = true;
}
if (blocked) process.exitCode = 1;
