import { hasTauriInvoke } from './env.js';
import { invokeChecked } from './invoke.js';
import { parseRuntimeDefaults, type RuntimeDefaults } from './types.js';

function trimTrailingSlashes(value: string): string {
  return String(value || '').replace(/\/+$/, '');
}

function extractPortFromHttpUrl(value: string): number {
  try {
    const parsed = new URL(String(value || '').trim());
    return Number(parsed.port || '') || (parsed.protocol === 'https:' ? 443 : 80);
  } catch {
    return 3002;
  }
}

function normalizeLoopbackHttpUrl(rawValue: string, defaultPort: number = 3002): string {
  const value = String(rawValue || '').trim();
  if (!value) {
    return '';
  }
  try {
    const parsed = new URL(value);
    const host = String(parsed.hostname || '').toLowerCase();
    const hasExplicitPort = String(parsed.port || '').trim().length > 0;
    const isLoopbackHttp = parsed.protocol === 'http:' && (host === 'localhost' || host === '127.0.0.1');
    if (isLoopbackHttp && !hasExplicitPort) {
      parsed.port = String(defaultPort);
    }
    return trimTrailingSlashes(parsed.toString());
  } catch {
    return trimTrailingSlashes(value);
  }
}

function deriveDefaultJwksUrl(realmBaseUrl: string): string {
  const normalizedBaseUrl = trimTrailingSlashes(realmBaseUrl);
  const baseUrl = normalizedBaseUrl || 'http://localhost:3002';
  return `${baseUrl}/api/auth/jwks`;
}

function readEnv(name: string): string {
  const importMetaEnv = (import.meta as { env?: Record<string, string> }).env;
  const processEnv =
    typeof globalThis.process !== 'undefined'
      ? ((globalThis.process as { env?: Record<string, string> }).env ?? {})
      : {};
  return String(importMetaEnv?.[name] || processEnv[name] || '').trim();
}

function resolveRealmBaseUrlFallback(): string {
  return readEnv('NIMI_REALM_URL') || 'http://localhost:3002';
}

function readRuntimeDefaultsFallback(): RuntimeDefaults {
  const realmBaseUrl = normalizeLoopbackHttpUrl(resolveRealmBaseUrlFallback(), 3002);
  const realmPort = extractPortFromHttpUrl(realmBaseUrl);
  const realtimeUrl = readEnv('NIMI_REALTIME_URL');
  const accessToken = readEnv('NIMI_ACCESS_TOKEN');
  const jwksUrl = normalizeLoopbackHttpUrl(
    readEnv('NIMI_REALM_JWKS_URL') || deriveDefaultJwksUrl(realmBaseUrl),
    realmPort,
  );
  const jwtIssuer = normalizeLoopbackHttpUrl(
    readEnv('NIMI_REALM_JWT_ISSUER') || realmBaseUrl,
    realmPort,
  );
  const jwtAudience = readEnv('NIMI_REALM_JWT_AUDIENCE') || 'nimi-runtime';
  const localProviderEndpoint = readEnv('NIMI_LOCAL_PROVIDER_ENDPOINT') || 'http://127.0.0.1:1234/v1';
  const localProviderModel = readEnv('NIMI_LOCAL_PROVIDER_MODEL') || 'local-model';
  const localOpenAiEndpoint = readEnv('NIMI_LOCAL_OPENAI_ENDPOINT') || 'http://127.0.0.1:1234/v1';
  const connectorId = readEnv('NIMI_CREDENTIAL_REF_ID');
  const targetType = readEnv('NIMI_TARGET_TYPE') || 'AGENT';
  const targetAccountId = readEnv('NIMI_TARGET_ACCOUNT_ID');
  const agentId = readEnv('NIMI_AGENT_ID');
  const worldId = readEnv('NIMI_WORLD_ID');
  const provider = readEnv('NIMI_PROVIDER');
  const userConfirmedUpload = readEnv('NIMI_USER_CONFIRMED_UPLOAD') === '1';
  return {
    realm: {
      realmBaseUrl,
      realtimeUrl,
      accessToken,
      jwksUrl,
      jwtIssuer,
      jwtAudience,
    },
    runtime: {
      localProviderEndpoint,
      localProviderModel,
      localOpenAiEndpoint,
      connectorId,
      targetType,
      targetAccountId,
      agentId,
      worldId,
      provider,
      userConfirmedUpload,
    },
  };
}

function applyEnvOverrides(base: RuntimeDefaults): RuntimeDefaults {
  const realmBaseUrl = readEnv('NIMI_REALM_URL');
  const realtimeUrl = readEnv('NIMI_REALTIME_URL');
  const accessToken = readEnv('NIMI_ACCESS_TOKEN');
  const nextRealmBaseUrl = normalizeLoopbackHttpUrl(realmBaseUrl || base.realm.realmBaseUrl, 3002);
  const realmPort = extractPortFromHttpUrl(nextRealmBaseUrl);
  const jwksUrl = readEnv('NIMI_REALM_JWKS_URL');
  const jwtIssuer = readEnv('NIMI_REALM_JWT_ISSUER');
  const jwtAudience = readEnv('NIMI_REALM_JWT_AUDIENCE');

  return {
    ...base,
    realm: {
      ...base.realm,
      realmBaseUrl: nextRealmBaseUrl,
      realtimeUrl: realtimeUrl || base.realm.realtimeUrl,
      accessToken: accessToken || base.realm.accessToken,
      jwksUrl: normalizeLoopbackHttpUrl(
        jwksUrl || base.realm.jwksUrl || deriveDefaultJwksUrl(nextRealmBaseUrl),
        realmPort,
      ),
      jwtIssuer: normalizeLoopbackHttpUrl(
        jwtIssuer || base.realm.jwtIssuer || nextRealmBaseUrl,
        realmPort,
      ),
      jwtAudience: jwtAudience || base.realm.jwtAudience || 'nimi-runtime',
    },
  };
}

export async function getRuntimeDefaults(): Promise<RuntimeDefaults> {
  if (!hasTauriInvoke()) {
    return readRuntimeDefaultsFallback();
  }
  const defaults = await invokeChecked('runtime_defaults', {}, parseRuntimeDefaults);
  return applyEnvOverrides(defaults);
}
