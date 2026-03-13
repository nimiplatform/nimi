// RL-BOOT-003 — Environment Variable Resolution

export interface RelayEnv {
  /** Runtime daemon gRPC endpoint. Default: 127.0.0.1:46371 */
  NIMI_RUNTIME_GRPC_ADDR: string;
  /** Realm API base URL. Required. */
  NIMI_REALM_URL: string;
  /** Bearer token for auth. Required. */
  NIMI_ACCESS_TOKEN: string;
  /** Default agent binding. Optional. */
  NIMI_AGENT_ID: string | undefined;
  /** Default world binding. Optional. */
  NIMI_WORLD_ID: string | undefined;
}

export function parseEnv(): RelayEnv {
  const realmUrl = process.env.NIMI_REALM_URL;
  if (!realmUrl) {
    throw new Error('NIMI_REALM_URL is required');
  }

  const accessToken = process.env.NIMI_ACCESS_TOKEN;
  if (!accessToken) {
    throw new Error('NIMI_ACCESS_TOKEN is required');
  }

  return {
    NIMI_RUNTIME_GRPC_ADDR: process.env.NIMI_RUNTIME_GRPC_ADDR || '127.0.0.1:46371',
    NIMI_REALM_URL: realmUrl,
    NIMI_ACCESS_TOKEN: accessToken,
    NIMI_AGENT_ID: process.env.NIMI_AGENT_ID || undefined,
    NIMI_WORLD_ID: process.env.NIMI_WORLD_ID || undefined,
  };
}
