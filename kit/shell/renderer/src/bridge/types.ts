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

function assertRecord(value: unknown, label: string): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label}: expected object, got ${typeof value}`);
  }
  return value as JsonObject;
}

function str(value: unknown, fallback = ''): string {
  return String(value ?? '').trim() || fallback;
}

function optionalStr(value: unknown): string | undefined {
  const normalized = String(value ?? '').trim();
  return normalized || undefined;
}

function optionalNum(value: unknown): number | undefined {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : undefined;
}

export function parseRuntimeDefaults(value: unknown): RuntimeDefaults {
  const record = assertRecord(value, 'runtime_defaults returned invalid payload');
  const realmRecord = assertRecord(record.realm, 'runtime_defaults realm payload is invalid');
  const runtimeRecord = assertRecord(record.runtime, 'runtime_defaults runtime payload is invalid');
  return {
    realm: {
      realmBaseUrl: str(realmRecord.realmBaseUrl),
      realtimeUrl: str(realmRecord.realtimeUrl),
      accessToken: str(realmRecord.accessToken),
      jwksUrl: str(realmRecord.jwksUrl),
      revocationUrl: str(realmRecord.revocationUrl),
      jwtIssuer: str(realmRecord.jwtIssuer),
      jwtAudience: str(realmRecord.jwtAudience),
    },
    runtime: {
      localProviderEndpoint: str(runtimeRecord.localProviderEndpoint),
      localProviderModel: str(runtimeRecord.localProviderModel),
      localOpenAiEndpoint: str(runtimeRecord.localOpenAiEndpoint),
      connectorId: str(runtimeRecord.connectorId || runtimeRecord.credentialRefId),
      targetType: str(runtimeRecord.targetType),
      targetAccountId: str(runtimeRecord.targetAccountId),
      agentId: str(runtimeRecord.agentId),
      worldId: str(runtimeRecord.worldId),
      provider: str(runtimeRecord.provider),
      userConfirmedUpload: Boolean(runtimeRecord.userConfirmedUpload),
    },
  };
}

export function parseRuntimeBridgeDaemonStatus(value: unknown): RuntimeBridgeDaemonStatus {
  const record = assertRecord(value, 'runtime_bridge_status returned invalid payload');
  const launchModeRaw = String(record.launchMode || '').trim().toUpperCase();
  const launchMode: RuntimeBridgeDaemonStatus['launchMode'] =
    launchModeRaw === 'RUNTIME' || launchModeRaw === 'RELEASE'
      ? launchModeRaw
      : 'INVALID';
  return {
    running: Boolean(record.running),
    managed: Boolean(record.managed),
    launchMode,
    grpcAddr: str(record.grpcAddr),
    pid: optionalNum(record.pid),
    version: optionalStr(record.version),
    lastError: optionalStr(record.lastError),
    debugLogPath: optionalStr(record.debugLogPath),
  };
}
