export function evaluateScan(report) {
  if (!report || !Array.isArray(report.matches) || report.descriptor?.name !== 'grype'
    || report.source?.type !== 'image' || report.descriptor?.db?.status?.valid !== true) {
    throw new Error('Scanner did not produce a valid Grype report');
  }
  const high = report.matches.filter((match) => {
    if (!match.vulnerability || !match.artifact) throw new Error('Malformed vulnerability record');
    if (!['Unknown', 'Negligible', 'Low', 'Medium', 'High', 'Critical'].includes(match.vulnerability.severity)) {
      throw new Error('Unrecognized vulnerability severity');
    }
    return ['High', 'Critical'].includes(match.vulnerability.severity);
  });
  const unfixed = high.filter((match) => {
    const fix = match.vulnerability.fix;
    if (!fix || !Array.isArray(fix.versions)) throw new Error('Missing fix metadata');
    return fix.versions.length === 0;
  });
  return { all: report.matches, blocking: high, unfixed };
}
