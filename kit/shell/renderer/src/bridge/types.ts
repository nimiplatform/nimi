export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = unknown;
export type JsonObject = Record<string, unknown>;

export type RealmDefaults = {
  realmBaseUrl: string;
  realtimeUrl: string;
  accessToken: string;
  jwksUrl: string;
  revocationUrl: string;
  jwtIssuer: string;
  jwtAudience: string;
};

export type RuntimeExecutionDefaults = {
  targetType: string;
  targetAccountId: string;
  agentId: string;
  worldId: string;
  userConfirmedUpload: boolean;
};

export type RuntimeDefaults = {
  realm: RealmDefaults;
  runtime: RuntimeExecutionDefaults;
};

export type RuntimeBridgeDaemonStatus = {
  running: boolean;
  managed: boolean;
  launchMode: 'RUNTIME' | 'RELEASE' | 'INVALID';
  grpcAddr: string;
  pid?: number;
  version?: string;
  lastError?: string;
  debugLogPath?: string;
};

export type RuntimeBridgeConfigGetResult = {
  path: string;
  config: JsonObject;
};

export type RuntimeBridgeConfigSetResult = {
  path: string;
  reasonCode?: string;
  actionHint?: string;
  config: JsonObject;
};

export type ConfirmDialogPayload = {
  title: string;
  description: string;
  level?: 'info' | 'warning' | 'error';
};

export type ConfirmDialogResult = {
  confirmed: boolean;
};

export function isJsonObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function assertRecord(value: unknown, errorMessage: string): JsonObject {
  if (!isJsonObject(value)) {
    throw new Error(errorMessage);
  }
  return value;
}

function assertBridgeRecord(value: unknown, label: string): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label}: expected object, got ${typeof value}`);
  }
  return value as JsonObject;
}

export function parseOptionalJsonObject(value: unknown): JsonObject | undefined {
  return isJsonObject(value) ? value : undefined;
}

export function parseRequiredString(
  value: unknown,
  fieldName: string,
  errorPrefix: string,
): string {
  const normalized = String(value || '').trim();
  if (!normalized) {
    throw new Error(`${errorPrefix}: ${fieldName} is required`);
  }
  return normalized;
}

function str(value: unknown, fallback = ''): string {
  return String(value ?? '').trim() || fallback;
}

export function parseOptionalString(value: unknown): string | undefined {
  const normalized = String(value || '').trim();
  return normalized || undefined;
}

export function parseOptionalNumber(value: unknown): number | undefined {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : undefined;
}

export function parseRuntimeDefaults(value: unknown): RuntimeDefaults {
  const record = assertBridgeRecord(value, 'runtime_defaults returned invalid payload');
  const realmRecord = assertBridgeRecord(record.realm, 'runtime_defaults realm payload is invalid');
  const runtimeRecord = assertBridgeRecord(record.runtime, 'runtime_defaults runtime payload is invalid');
  return {
    realm: {
      realmBaseUrl: parseRequiredString(realmRecord.realmBaseUrl, 'realm.realmBaseUrl', 'runtime_defaults'),
      realtimeUrl: str(realmRecord.realtimeUrl),
      accessToken: str(realmRecord.accessToken),
      jwksUrl: parseRequiredString(realmRecord.jwksUrl, 'realm.jwksUrl', 'runtime_defaults'),
      revocationUrl: parseRequiredString(realmRecord.revocationUrl, 'realm.revocationUrl', 'runtime_defaults'),
      jwtIssuer: parseRequiredString(realmRecord.jwtIssuer, 'realm.jwtIssuer', 'runtime_defaults'),
      jwtAudience: parseRequiredString(realmRecord.jwtAudience, 'realm.jwtAudience', 'runtime_defaults'),
    },
    runtime: {
      targetType: str(runtimeRecord.targetType),
      targetAccountId: str(runtimeRecord.targetAccountId),
      agentId: str(runtimeRecord.agentId),
      worldId: str(runtimeRecord.worldId),
      userConfirmedUpload: Boolean(runtimeRecord.userConfirmedUpload),
    },
  };
}

export function parseRuntimeBridgeDaemonStatus(value: unknown): RuntimeBridgeDaemonStatus {
  const record = assertBridgeRecord(value, 'runtime_bridge_status returned invalid payload');
  const launchModeRaw = String(record.launchMode || '').trim().toUpperCase();
  const launchMode: RuntimeBridgeDaemonStatus['launchMode'] =
    launchModeRaw === 'RUNTIME' || launchModeRaw === 'RELEASE'
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
    debugLogPath: parseOptionalString(record.debugLogPath),
  };
}

export function parseRuntimeBridgeConfigGetResult(value: unknown): RuntimeBridgeConfigGetResult {
  const record = assertBridgeRecord(value, 'runtime_bridge_config_get returned invalid payload');
  const config = assertBridgeRecord(record.config, 'runtime_bridge_config_get config payload is invalid');
  return {
    path: parseRequiredString(record.path, 'path', 'runtime_bridge_config_get'),
    config,
  };
}

export function parseRuntimeBridgeConfigSetResult(value: unknown): RuntimeBridgeConfigSetResult {
  const record = assertBridgeRecord(value, 'runtime_bridge_config_set returned invalid payload');
  const config = assertBridgeRecord(record.config, 'runtime_bridge_config_set config payload is invalid');
  return {
    path: parseRequiredString(record.path, 'path', 'runtime_bridge_config_set'),
    reasonCode: parseOptionalString(record.reasonCode),
    actionHint: parseOptionalString(record.actionHint),
    config,
  };
}

export function parseConfirmDialogResult(value: unknown): ConfirmDialogResult {
  const record = assertBridgeRecord(value, 'confirm_dialog returned invalid payload');
  return {
    confirmed: Boolean(record.confirmed),
  };
}
