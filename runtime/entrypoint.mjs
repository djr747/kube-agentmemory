import { mkdirSync } from 'node:fs';
import { loadSecrets } from './secrets.mjs';
import { waitForEngine } from './engine.mjs';

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
  await waitForEngine(engine);
  // Start the packaged worker directly; avoid CLI onboarding, updates and downloads.
  await import('@agentmemory/agentmemory');
} catch (error) {
  console.error(`Startup failed: ${error.message}`);
  process.exit(1);
}
