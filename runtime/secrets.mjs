import { readFileSync } from 'node:fs';
import { parse } from 'dotenv';

// Only credentials may be loaded from *_FILE. No shell execution or expansion.
export const secretNames = [
  'AGENTMEMORY_SECRET', 'OPENAI_API_KEY', 'OPENAI_EMBEDDING_API_KEY',
  'ANTHROPIC_API_KEY', 'GEMINI_API_KEY', 'GOOGLE_API_KEY', 'OPENROUTER_API_KEY',
  'MINIMAX_API_KEY', 'VOYAGE_API_KEY', 'COHERE_API_KEY', 'AGENTMEMORY_REDIS_URL',
];

export function loadSecrets(env = process.env, read = readFileSync) {
  if (env.AGENTMEMORY_ENV_FILE) {
    let values;
    try {
      values = parse(read(env.AGENTMEMORY_ENV_FILE, 'utf8'));
    } catch {
      throw new Error('Cannot read AGENTMEMORY_ENV_FILE');
    }
    for (const [name, value] of Object.entries(values)) {
      if (!secretNames.includes(name)) {
        throw new Error(`Unsupported credential in AGENTMEMORY_ENV_FILE: ${name}`);
      }
      if (env[name] === undefined && env[`${name}_FILE`] === undefined) env[name] = value;
    }
  }
  for (const name of secretNames) {
    const path = env[`${name}_FILE`];
    if (!path) continue;
    if (env[name] !== undefined) throw new Error(`Set only ${name} or ${name}_FILE`);
    try {
      env[name] = read(path, 'utf8').replace(/\r?\n$/, '');
    } catch {
      throw new Error(`Cannot read ${name}_FILE`);
    }
    if (!env[name]) throw new Error(`Empty credential: ${name}_FILE`);
  }
  if (!env.AGENTMEMORY_SECRET || env.AGENTMEMORY_SECRET.length < 32) {
    throw new Error('AGENTMEMORY_SECRET must contain at least 32 characters');
  }
  return env;
}
