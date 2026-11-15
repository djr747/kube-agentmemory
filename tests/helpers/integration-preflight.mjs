import { execFileSync } from 'node:child_process';

export function checkContainerRuntime(execute = execFileSync) {
  try {
    const version = execute('docker', ['info', '--format', '{{.ServerVersion}}'], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
    if (!version) throw new Error('docker info returned an empty server version');
    return version;
  } catch (error) {
    const detail = error?.stderr?.toString().trim() || error?.message || String(error);
    throw new Error(
      `Integration preflight failed: the Docker-compatible container API is not reachable. ` +
      `Start Docker Engine or the Podman machine, then verify that "docker info" succeeds.\n${detail}`,
      { cause: error },
    );
  }
}
