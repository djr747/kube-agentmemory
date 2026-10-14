import { setTimeout as delay } from 'node:timers/promises';

// Ready Pods can precede kube-proxy's replacement Service routes. Retry refused
// connections only; HTTP responses, authentication failures and other errors
// reach the caller immediately.
export async function fetchWhenServiceReady(url, options = {}, {
  attempts = 31, delayMs = 1000, fetchImpl = fetch,
} = {}) {
  async function request(remaining) {
    try { return await fetchImpl(url, { ...options, signal: AbortSignal.timeout(30000) }); }
    catch (error) {
      if (error.cause?.code !== 'ECONNREFUSED' || remaining <= 1) throw error;
      await delay(delayMs);
      return request(remaining - 1);
    }
  }
  return request(attempts);
}
