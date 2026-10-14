import { connect } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';

function responds(engine, timeout) {
  return new Promise((resolve) => {
    const socket = connect({ host: engine.hostname, port: Number(engine.port || 49134) });
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(timeout);
    socket.on('connect', () => finish(true));
    socket.on('error', () => finish(false));
    socket.on('timeout', () => finish(false));
  });
}

export async function waitForEngine(engine, { timeoutMs = 120000, pollIntervalMs = 500, connectTimeoutMs = 1000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  async function poll() {
    if (Date.now() >= deadline) throw new Error('Engine readiness deadline exceeded');
    if (await responds(engine, Math.max(1, Math.min(connectTimeoutMs, deadline - Date.now())))) return;
    await delay(pollIntervalMs);
    return poll();
  }
  return poll();
}
