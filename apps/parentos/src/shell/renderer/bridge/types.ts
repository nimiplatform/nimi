export type JsonValue = unknown;

export type RealmDefaults = {
  realmBaseUrl: string;
  realtimeUrl: string;
  accessToken: string;
  jwksUrl: string;
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
  webBaseUrl: string;
  realm: RealmDefaults;
  runtime: RuntimeExecutionDefaults;
};

function assertRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label}: expected object, got ${typeof value}`);
  }
  return value as Record<string, unknown>;
}

function str(value: unknown, fallback = ''): string {
  return String(value ?? '').trim() || fallback;
}

export function parseRuntimeDefaults(value: unknown): RuntimeDefaults {
  const record = assertRecord(value, 'runtime_defaults returned invalid payload');
  const realmRecord = assertRecord(record.realm, 'runtime_defaults realm payload is invalid');
  const runtimeRecord = assertRecord(record.runtime, 'runtime_defaults runtime payload is invalid');
  return {
    webBaseUrl: str(record.webBaseUrl),
    realm: {
      realmBaseUrl: str(realmRecord.realmBaseUrl),
      realtimeUrl: str(realmRecord.realtimeUrl),
      accessToken: str(realmRecord.accessToken),
      jwksUrl: str(realmRecord.jwksUrl),
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
