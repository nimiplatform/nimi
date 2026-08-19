export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | undefined | readonly JsonValue[] | JsonObject;
export type JsonObject = {
  [key: string]: JsonValue;
};

export type RealmDefaults = {
  realmBaseUrl: string;
  realtimeUrl: string;
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
  launchMode: 'SOURCE' | 'RUNTIME' | 'RELEASE' | 'INVALID';
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
  const record = assertBridgeRecord(value, 'nimi.shell.runtimeDefaults.get returned invalid payload');
  const realmRecord = assertBridgeRecord(record.realm, 'nimi.shell.runtimeDefaults.get realm payload is invalid');
  const runtimeRecord = assertBridgeRecord(record.runtime, 'nimi.shell.runtimeDefaults.get runtime payload is invalid');
  return {
    realm: {
      realmBaseUrl: parseRequiredString(realmRecord.realmBaseUrl, 'realm.realmBaseUrl', 'nimi.shell.runtimeDefaults.get'),
      realtimeUrl: str(realmRecord.realtimeUrl),
      jwksUrl: parseRequiredString(realmRecord.jwksUrl, 'realm.jwksUrl', 'nimi.shell.runtimeDefaults.get'),
      revocationUrl: parseRequiredString(realmRecord.revocationUrl, 'realm.revocationUrl', 'nimi.shell.runtimeDefaults.get'),
      jwtIssuer: parseRequiredString(realmRecord.jwtIssuer, 'realm.jwtIssuer', 'nimi.shell.runtimeDefaults.get'),
      jwtAudience: parseRequiredString(realmRecord.jwtAudience, 'realm.jwtAudience', 'nimi.shell.runtimeDefaults.get'),
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
  const record = assertBridgeRecord(value, 'nimi.shell.runtimeLifecycle.status returned invalid payload');
  const launchModeRaw = String(record.launchMode || '').trim().toUpperCase();
  const launchMode: RuntimeBridgeDaemonStatus['launchMode'] =
    launchModeRaw === 'SOURCE' || launchModeRaw === 'RUNTIME' || launchModeRaw === 'RELEASE'
      ? launchModeRaw
      : 'INVALID';
  return {
    running: Boolean(record.running),
    managed: Boolean(record.managed),
    launchMode,
    grpcAddr: parseRequiredString(record.grpcAddr, 'grpcAddr', 'nimi.shell.runtimeLifecycle.status'),
    pid: parseOptionalNumber(record.pid),
    version: parseOptionalString(record.version),
    lastError: parseOptionalString(record.lastError),
    debugLogPath: parseOptionalString(record.debugLogPath),
  };
}

export function parseRuntimeBridgeConfigGetResult(value: unknown): RuntimeBridgeConfigGetResult {
  const record = assertBridgeRecord(value, 'nimi.shell.config.get returned invalid payload');
  const config = assertBridgeRecord(record.config, 'nimi.shell.config.get config payload is invalid');
  return {
    path: parseRequiredString(record.path, 'path', 'nimi.shell.config.get'),
    config,
  };
}

export function parseRuntimeBridgeConfigSetResult(value: unknown): RuntimeBridgeConfigSetResult {
  const record = assertBridgeRecord(value, 'nimi.shell.config.set returned invalid payload');
  const config = assertBridgeRecord(record.config, 'nimi.shell.config.set config payload is invalid');
  return {
    path: parseRequiredString(record.path, 'path', 'nimi.shell.config.set'),
    reasonCode: parseOptionalString(record.reasonCode),
    actionHint: parseOptionalString(record.actionHint),
    config,
  };
}

export function parseConfirmDialogResult(value: unknown): ConfirmDialogResult {
  const record = assertBridgeRecord(value, 'nimi.shell.ui.confirmDialog returned invalid payload');
  return {
    confirmed: Boolean(record.confirmed),
  };
}
