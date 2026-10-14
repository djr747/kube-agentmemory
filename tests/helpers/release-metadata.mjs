export function releaseMetadata(pkg, lock, changelog) {
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(pkg.version)) throw new Error('Release version must be stable SemVer');
  const agentmemory = pkg.dependencies['@agentmemory/agentmemory'];
  const iii = lock.packages['node_modules/iii-sdk'].version;
  for (const version of [agentmemory, iii]) {
    if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Upstream versions must be exact stable pins');
  }
  const heading = `## [${pkg.version}] - `;
  const section = changelog.split('\n').findIndex((line) => line.startsWith(heading) && /^\d{4}-\d{2}-\d{2}$/.test(line.slice(heading.length)));
  if (section < 0) throw new Error('Missing dated release changelog');
  const lines = changelog.split('\n').slice(section + 1);
  const next = lines.findIndex((line) => line.startsWith('## ['));
  const notes = (next < 0 ? lines : lines.slice(0, next)).join('\n').trim();
  if (!notes) throw new Error('Release notes must not be empty');
  const upstreamTag = `${pkg.version}-agentmemory${agentmemory}-iii${iii}`;
  return { version: pkg.version, agentmemory, iii, upstreamTag, notes,
    tags: [pkg.version, pkg.version.split('.').slice(0, 2).join('.'), pkg.version.split('.')[0], upstreamTag, 'latest'] };
}
