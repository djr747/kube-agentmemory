import { mkdirSync } from 'node:fs';
import { connect } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { loadSecrets } from './secrets.mjs';

try {
  loadSecrets();
  for (const directory of [process.env.HOME, process.env.HF_HOME, process.env.XDG_CACHE_HOME,
    process.env.AGENTMEMORY_EXPORT_ROOT, process.env.SNAPSHOT_DIR]) {
    if (directory) mkdirSync(directory, { recursive: true, mode: 0o700 });
  }
  if (process.env.EMBEDDING_PROVIDER === 'local') {
    const { env } = await import('@huggingface/transformers');
    // Transformers.js otherwise caches inside node_modules, which is read-only.
    env.cacheDir = process.env.HF_HOME || '/data/models';
  }
  const engine = new URL(process.env.III_ENGINE_URL || 'ws://127.0.0.1:49134');
  if (!['ws:', 'wss:'].includes(engine.protocol)) throw new Error('Invalid engine URL');
  const deadline = Date.now() + 120000;
  let ready = false;
  while (Date.now() < deadline) {
    ready = await new Promise((resolve) => {
      const socket = connect({ host: engine.hostname, port: Number(engine.port || 49134) });
      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        socket.destroy();
        resolve(value);
      };
      socket.setTimeout(1000);
      socket.on('connect', () => finish(true));
      socket.on('error', () => finish(false));
      socket.on('timeout', () => finish(false));
    });
    if (ready) break;
    await delay(500);
  }
  if (!ready) throw new Error('Engine readiness deadline exceeded');
  // Start the packaged worker directly; avoid CLI onboarding, updates and downloads.
  await import('@agentmemory/agentmemory');
} catch (error) {
  console.error(`Startup failed: ${error.message}`);
  process.exit(1);
}
