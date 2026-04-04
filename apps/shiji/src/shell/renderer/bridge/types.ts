export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = unknown;
export type JsonObject = Record<string, unknown>;

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
  realm: RealmDefaults;
  runtime: RuntimeExecutionDefaults;
};

function assertRecord(value: unknown, label: string): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label}: expected object`);
  }
  return value as JsonObject;
}

function readString(value: unknown, label: string): string {
  if (typeof value !== 'string') {
    throw new Error(`${label}: expected string`);
  }
  return value.trim();
}

function readRequiredString(record: JsonObject, key: string, label: string): string {
  const value = readString(record[key], `${label}.${key}`);
  if (!value) {
    throw new Error(`${label}.${key}: expected non-empty string`);
  }
  return value;
}

function readOptionalString(record: JsonObject, key: string, label: string): string {
  const value = record[key];
  if (value == null) {
    return '';
  }
  return readString(value, `${label}.${key}`);
}

function readBoolean(record: JsonObject, key: string, label: string): boolean {
  if (typeof record[key] !== 'boolean') {
    throw new Error(`${label}.${key}: expected boolean`);
  }
  return record[key] as boolean;
}

function assertUrl(value: string, label: string): string {
  try {
    const parsed = new URL(value);
    if (!parsed.protocol || !parsed.hostname) {
      throw new Error('missing protocol or hostname');
    }
    return parsed.toString().replace(/\/+$/, '');
  } catch (error) {
    throw new Error(`${label}: invalid URL (${error instanceof Error ? error.message : String(error)})`);
  }
}

export function parseRuntimeDefaults(value: unknown): RuntimeDefaults {
  const record = assertRecord(value, 'runtime_defaults returned invalid payload');
  const realmRecord = assertRecord(record['realm'], 'runtime_defaults realm payload is invalid');
  const runtimeRecord = assertRecord(record['runtime'], 'runtime_defaults runtime payload is invalid');

  const realmBaseUrl = assertUrl(
    readRequiredString(realmRecord, 'realmBaseUrl', 'runtime_defaults.realm'),
    'runtime_defaults.realm.realmBaseUrl',
  );
  const jwksUrl = assertUrl(
    readRequiredString(realmRecord, 'jwksUrl', 'runtime_defaults.realm'),
    'runtime_defaults.realm.jwksUrl',
  );
  const jwtIssuer = assertUrl(
    readRequiredString(realmRecord, 'jwtIssuer', 'runtime_defaults.realm'),
    'runtime_defaults.realm.jwtIssuer',
  );

  const localProviderEndpoint = readOptionalString(runtimeRecord, 'localProviderEndpoint', 'runtime_defaults.runtime');
  const localOpenAiEndpoint = readOptionalString(runtimeRecord, 'localOpenAiEndpoint', 'runtime_defaults.runtime');

  return {
    realm: {
      realmBaseUrl,
      realtimeUrl: readOptionalString(realmRecord, 'realtimeUrl', 'runtime_defaults.realm'),
      accessToken: readOptionalString(realmRecord, 'accessToken', 'runtime_defaults.realm'),
      jwksUrl,
      jwtIssuer,
      jwtAudience: readRequiredString(realmRecord, 'jwtAudience', 'runtime_defaults.realm'),
    },
    runtime: {
      localProviderEndpoint: localProviderEndpoint ? assertUrl(localProviderEndpoint, 'runtime_defaults.runtime.localProviderEndpoint') : '',
      localProviderModel: readOptionalString(runtimeRecord, 'localProviderModel', 'runtime_defaults.runtime'),
      localOpenAiEndpoint: localOpenAiEndpoint ? assertUrl(localOpenAiEndpoint, 'runtime_defaults.runtime.localOpenAiEndpoint') : '',
      connectorId: readOptionalString(
        { connectorId: runtimeRecord['connectorId'] ?? runtimeRecord['credentialRefId'] ?? '' },
        'connectorId',
        'runtime_defaults.runtime',
      ),
      targetType: readOptionalString(runtimeRecord, 'targetType', 'runtime_defaults.runtime'),
      targetAccountId: readOptionalString(runtimeRecord, 'targetAccountId', 'runtime_defaults.runtime'),
      agentId: readOptionalString(runtimeRecord, 'agentId', 'runtime_defaults.runtime'),
      worldId: readOptionalString(runtimeRecord, 'worldId', 'runtime_defaults.runtime'),
      provider: readOptionalString(runtimeRecord, 'provider', 'runtime_defaults.runtime'),
      userConfirmedUpload: readBoolean(runtimeRecord, 'userConfirmedUpload', 'runtime_defaults.runtime'),
    },
  };
}
