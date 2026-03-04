import {
  assertRecord,
  parseOptionalNumber,
  parseOptionalString,
  parseRequiredString,
} from './shared.js';
export type RealmDefaults = {
  realmBaseUrl: string;
  realtimeUrl: string;
  accessToken: string;
};

export type RuntimeExecutionDefaults = {
  localProviderEndpoint: string;
  localProviderModel: string;
  localOpenAiEndpoint: string;
  connectorId: string;
  targetType: string;
  targetAccountId: string;
  agentId: string;
  worldId: string;
  provider: string;
  userConfirmedUpload: boolean;
};

export type RuntimeDefaults = {
  realm: RealmDefaults;
  runtime: RuntimeExecutionDefaults;
};

export type SystemResourceSnapshot = {
  cpuPercent: number;
  memoryUsedBytes: number;
  memoryTotalBytes: number;
  diskUsedBytes: number;
  diskTotalBytes: number;
  temperatureCelsius?: number;
  capturedAtMs: number;
  source: string;
};

export type RuntimeBridgeDaemonStatus = {
  running: boolean;
  managed: boolean;
  launchMode: 'RUNTIME' | 'RELEASE' | 'INVALID';
  grpcAddr: string;
  pid?: number;
  version?: string;
  lastError?: string;
};

export type RuntimeBridgeConfigGetResult = {
  path: string;
  config: Record<string, unknown>;
};

export type RuntimeBridgeConfigSetResult = {
  path: string;
  reasonCode?: string;
  actionHint?: string;
  config: Record<string, unknown>;
};

export type RuntimeLocalManifestSummary = {
  path: string;
  id: string;
  name?: string;
  version?: string;
  entry?: string;
  entryPath?: string;
  description?: string;
  manifest?: Record<string, unknown>;
};

export type OpenExternalUrlResult = {
  opened: boolean;
};

export type OauthTokenExchangePayload = {
  tokenUrl: string;
  clientId: string;
  code: string;
  codeVerifier?: string;
  redirectUri?: string;
  clientSecret?: string;
  extra?: Record<string, string>;
};

export type OauthTokenExchangeResult = {
  accessToken: string;
  refreshToken?: string;
  tokenType?: string;
  expiresIn?: number;
  scope?: string;
  raw: Record<string, unknown>;
};

export type OauthListenForCodePayload = {
  redirectUri: string;
  timeoutMs?: number;
};

export type OauthListenForCodeResult = {
  callbackUrl: string;
  code?: string;
  state?: string;
  error?: string;
};

export type ConfirmPrivateSyncPayload = {
  agentId?: string;
  sessionId?: string;
};

export type ConfirmPrivateSyncResult = {
  confirmed: boolean;
};

export function parseRuntimeDefaults(value: unknown): RuntimeDefaults {
  const record = assertRecord(value, 'runtime_defaults returned invalid payload');
  const realmRecord = assertRecord(record.realm, 'runtime_defaults realm payload is invalid');
  const runtimeRecord = assertRecord(record.runtime, 'runtime_defaults runtime payload is invalid');
  return {
    realm: {
      realmBaseUrl: parseRequiredString(
        realmRecord.realmBaseUrl,
        'realm.realmBaseUrl',
        'runtime_defaults',
      ),
      realtimeUrl: String(realmRecord.realtimeUrl || '').trim(),
      accessToken: String(realmRecord.accessToken || '').trim(),
    },
    runtime: {
      localProviderEndpoint: parseRequiredString(
        runtimeRecord.localProviderEndpoint,
        'runtime.localProviderEndpoint',
        'runtime_defaults',
      ),
      localProviderModel: parseRequiredString(
        runtimeRecord.localProviderModel,
        'runtime.localProviderModel',
        'runtime_defaults',
      ),
      localOpenAiEndpoint: parseRequiredString(
        runtimeRecord.localOpenAiEndpoint,
        'runtime.localOpenAiEndpoint',
        'runtime_defaults',
      ),
      connectorId: String(runtimeRecord.connectorId || '').trim(),
      targetType: parseRequiredString(runtimeRecord.targetType, 'runtime.targetType', 'runtime_defaults'),
      targetAccountId: String(runtimeRecord.targetAccountId || '').trim(),
      agentId: String(runtimeRecord.agentId || '').trim(),
      worldId: String(runtimeRecord.worldId || '').trim(),
      provider: String(runtimeRecord.provider || '').trim(),
      userConfirmedUpload: Boolean(runtimeRecord.userConfirmedUpload),
    },
  };
}

export function parseSystemResourceSnapshot(value: unknown): SystemResourceSnapshot {
  const record = assertRecord(value, 'get_system_resource_snapshot returned invalid payload');
  const cpuPercent = Number(record.cpuPercent);
  const memoryUsedBytes = Number(record.memoryUsedBytes);
  const memoryTotalBytes = Number(record.memoryTotalBytes);
  const diskUsedBytes = Number(record.diskUsedBytes);
  const diskTotalBytes = Number(record.diskTotalBytes);
  const capturedAtMs = Number(record.capturedAtMs);
  if (!Number.isFinite(cpuPercent)) {
    throw new Error('get_system_resource_snapshot: cpuPercent is required');
  }
  if (!Number.isFinite(memoryUsedBytes) || !Number.isFinite(memoryTotalBytes)) {
    throw new Error('get_system_resource_snapshot: memory bytes are required');
  }
  if (!Number.isFinite(diskUsedBytes) || !Number.isFinite(diskTotalBytes)) {
    throw new Error('get_system_resource_snapshot: disk bytes are required');
  }
  if (!Number.isFinite(capturedAtMs)) {
    throw new Error('get_system_resource_snapshot: capturedAtMs is required');
  }
  return {
    cpuPercent,
    memoryUsedBytes,
    memoryTotalBytes,
    diskUsedBytes,
    diskTotalBytes,
    temperatureCelsius: parseOptionalNumber(record.temperatureCelsius),
    capturedAtMs,
    source: parseRequiredString(record.source, 'source', 'get_system_resource_snapshot'),
  };
}

export function parseRuntimeBridgeDaemonStatus(value: unknown): RuntimeBridgeDaemonStatus {
  const record = assertRecord(value, 'runtime_bridge_status returned invalid payload');
  const launchModeRaw = String(record.launchMode || '').trim().toUpperCase();
  const launchMode = launchModeRaw === 'RUNTIME' || launchModeRaw === 'RELEASE'
    ? launchModeRaw
    : 'INVALID';
  return {
    running: Boolean(record.running),
    managed: Boolean(record.managed),
    launchMode,
    grpcAddr: parseRequiredString(record.grpcAddr, 'grpcAddr', 'runtime_bridge_status'),
    pid: parseOptionalNumber(record.pid),
    version: parseOptionalString(record.version),
    lastError: parseOptionalString(record.lastError),
  };
}

export function parseRuntimeBridgeConfigGetResult(value: unknown): RuntimeBridgeConfigGetResult {
  const record = assertRecord(value, 'runtime_bridge_config_get returned invalid payload');
  const config = assertRecord(record.config, 'runtime_bridge_config_get config payload is invalid');
  return {
    path: parseRequiredString(record.path, 'path', 'runtime_bridge_config_get'),
    config,
  };
}

export function parseRuntimeBridgeConfigSetResult(value: unknown): RuntimeBridgeConfigSetResult {
  const record = assertRecord(value, 'runtime_bridge_config_set returned invalid payload');
  const config = assertRecord(record.config, 'runtime_bridge_config_set config payload is invalid');
  return {
    path: parseRequiredString(record.path, 'path', 'runtime_bridge_config_set'),
    reasonCode: parseOptionalString(record.reasonCode),
    actionHint: parseOptionalString(record.actionHint),
    config,
  };
}

export function parseRuntimeLocalManifestSummary(value: unknown): RuntimeLocalManifestSummary {
  const record = assertRecord(value, 'runtime_mod_list_local_manifests returned invalid manifest payload');
  const manifestRecord = record.manifest && typeof record.manifest === 'object' && !Array.isArray(record.manifest)
    ? (record.manifest as Record<string, unknown>)
    : undefined;
  return {
    path: parseRequiredString(record.path, 'path', 'runtime_mod_list_local_manifests'),
    id: parseRequiredString(record.id, 'id', 'runtime_mod_list_local_manifests'),
    name: parseOptionalString(record.name),
    version: parseOptionalString(record.version),
    entry: parseOptionalString(record.entry),
    entryPath: parseOptionalString(record.entryPath),
    description: parseOptionalString(record.description),
    manifest: manifestRecord,
  };
}

export function parseRuntimeLocalManifestSummaries(value: unknown): RuntimeLocalManifestSummary[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((item) => parseRuntimeLocalManifestSummary(item));
}

export function parseOpenExternalUrlResult(value: unknown): OpenExternalUrlResult {
  const record = assertRecord(value, 'open_external_url returned invalid payload');
  return {
    opened: Boolean(record.opened),
  };
}

export function parseConfirmPrivateSyncResult(value: unknown): ConfirmPrivateSyncResult {
  const record = assertRecord(value, 'confirm_private_sync returned invalid payload');
  return {
    confirmed: Boolean(record.confirmed),
  };
}

export function parseOauthTokenExchangeResult(value: unknown): OauthTokenExchangeResult {
  const record = assertRecord(value, 'oauth_token_exchange returned invalid payload');
  const raw = record.raw && typeof record.raw === 'object' && !Array.isArray(record.raw)
    ? (record.raw as Record<string, unknown>)
    : {};
  return {
    accessToken: parseRequiredString(record.accessToken, 'accessToken', 'oauth_token_exchange'),
    refreshToken: parseOptionalString(record.refreshToken),
    tokenType: parseOptionalString(record.tokenType),
    expiresIn: Number.isFinite(Number(record.expiresIn)) ? Number(record.expiresIn) : undefined,
    scope: parseOptionalString(record.scope),
    raw,
  };
}

export function parseOauthListenForCodeResult(value: unknown): OauthListenForCodeResult {
  const record = assertRecord(value, 'oauth_listen_for_code returned invalid payload');
  return {
    callbackUrl: parseRequiredString(record.callbackUrl, 'callbackUrl', 'oauth_listen_for_code'),
    code: parseOptionalString(record.code),
    state: parseOptionalString(record.state),
    error: parseOptionalString(record.error),
  };
}
