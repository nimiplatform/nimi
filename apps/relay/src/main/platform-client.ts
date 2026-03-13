// RL-BOOT-001, RL-BOOT-003, RL-TRANS-001, RL-INTOP-002
// Platform client: Runtime (node-grpc) + Realm (openapi-fetch)

import { Runtime } from '@nimiplatform/sdk/runtime';
import { Realm } from '@nimiplatform/sdk/realm';
import type { RelayEnv } from './env.js';

let runtime: Runtime | null = null;
let realm: Realm | null = null;

export function initPlatformClient(env: RelayEnv): { runtime: Runtime; realm: Realm } {
  // RL-TRANS-001: node-grpc connectivity
  // RL-INTOP-002: appId = 'nimi.relay'
  runtime = new Runtime({
    appId: 'nimi.relay',
    transport: {
      type: 'node-grpc',
      endpoint: env.NIMI_RUNTIME_GRPC_ADDR,
    },
    auth: {
      // RL-TRANS-003: accessToken as provider function, not static string
      accessToken: () => Promise.resolve(env.NIMI_ACCESS_TOKEN),
    },
  });

  realm = new Realm({
    baseUrl: env.NIMI_REALM_URL,
    auth: {
      accessToken: env.NIMI_ACCESS_TOKEN,
    },
  });

  return { runtime, realm };
}

export function getRuntime(): Runtime {
  if (!runtime) {
    throw new Error('Runtime not initialized. Call initPlatformClient first.');
  }
  return runtime;
}

export function getRealm(): Realm {
  if (!realm) {
    throw new Error('Realm not initialized. Call initPlatformClient first.');
  }
  return realm;
}
