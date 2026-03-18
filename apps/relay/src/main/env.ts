// RL-BOOT-003 — Environment Variable Resolution
// RL-BOOT-005 — .env file loading from monorepo root

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface RelayEnv {
  /** Runtime daemon gRPC endpoint. Default: 127.0.0.1:46371 */
  NIMI_RUNTIME_GRPC_ADDR: string;
  /** Realm API base URL. Required. */
  NIMI_REALM_URL: string;
  /** Bearer token for auth. Optional — triggers browser auth when missing. */
  NIMI_ACCESS_TOKEN: string | undefined;
  /** Web login page URL for browser auth flow. */
  NIMI_WEB_URL: string;
  /** Default agent binding. Optional. */
  NIMI_AGENT_ID: string | undefined;
  /** Default world binding. Optional. */
  NIMI_WORLD_ID: string | undefined;
}

/**
 * Minimal .env parser — reads KEY=VALUE lines, respects # comments,
 * does NOT override existing process.env values.
 */
function loadDotEnv(): void {
  // Walk up from __dirname to find monorepo root containing .env
  // Build output: apps/relay/dist/main/index.cjs → walk up 4 levels to nimi/
  let dir = __dirname;
  for (let i = 0; i < 6; i++) {
    const candidate = path.join(dir, '.env');
    try {
      const content = fs.readFileSync(candidate, 'utf-8');
      for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx < 1) continue;
        const key = trimmed.slice(0, eqIdx).trim();
        const value = trimmed.slice(eqIdx + 1).trim();
        // Do not override existing env vars
        if (process.env[key] === undefined || process.env[key] === '') {
          process.env[key] = value;
        }
      }
      return; // Found and loaded
    } catch {
      // .env not found at this level — keep walking up
    }
    dir = path.dirname(dir);
  }
}

const DEFAULT_GRPC_ADDR = '127.0.0.1:46371';

/** Resolve config.json path: NIMI_RUNTIME_CONFIG_PATH env > ~/.nimi/config.json */
export function resolveRuntimeConfigPath(): string {
  return process.env.NIMI_RUNTIME_CONFIG_PATH || path.join(os.homedir(), '.nimi', 'config.json');
}

/** Read grpcAddr from config.json. Returns undefined on any error. */
export function readConfigGrpcAddr(): string | undefined {
  try {
    const content = fs.readFileSync(resolveRuntimeConfigPath(), 'utf-8');
    const config = JSON.parse(content);
    const addr = config.grpcAddr;
    return typeof addr === 'string' && addr.length > 0 ? addr : undefined;
  } catch {
    return undefined;
  }
}

export function parseEnv(): RelayEnv {
  // Load .env before reading process.env
  loadDotEnv();

  const realmUrl = process.env.NIMI_REALM_URL;
  if (!realmUrl) {
    throw new Error('NIMI_REALM_URL is required (set in .env or environment)');
  }

  return {
    NIMI_RUNTIME_GRPC_ADDR: process.env.NIMI_RUNTIME_GRPC_ADDR || readConfigGrpcAddr() || DEFAULT_GRPC_ADDR,
    NIMI_REALM_URL: realmUrl,
    NIMI_ACCESS_TOKEN: process.env.NIMI_ACCESS_TOKEN || undefined,
    NIMI_WEB_URL: process.env.NIMI_WEB_URL || 'http://localhost:3000',
    NIMI_AGENT_ID: process.env.NIMI_AGENT_ID || undefined,
    NIMI_WORLD_ID: process.env.NIMI_WORLD_ID || undefined,
  };
}
