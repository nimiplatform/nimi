import { createNimiAppRuntimePlatformClient, type NimiAppAuthMode, type NimiAppAuthProjection } from '@nimiplatform/sdk';

export const appId = 'dev.nimi.tester';
export const appTitle = 'Nimi Tester';
export const scaffoldProfile = 'standalone' as const;
export const runtimeAccountLoginEnabled = true;

type RuntimeEnv = Record<string, string | boolean | undefined>;

let runtimeProjection: Promise<NimiAppAuthProjection> | null = null;

function runtimeEnv(): RuntimeEnv {
  return ((import.meta as ImportMeta & { env?: RuntimeEnv }).env || {});
}

function resolveRuntimeAuthMode(env: RuntimeEnv): NimiAppAuthMode {
  if (env.VITE_NIMI_APP_AUTH_MODE === 'dev-standalone') {
    return 'dev-standalone';
  }
  return runtimeAccountLoginEnabled ? 'local-first-party' : 'third-party-nimi-app';
}

export function clearRuntimePlatformProjection() {
  runtimeProjection = null;
}

export function getRuntimePlatformProjection() {
  const env = runtimeEnv();
  const mode = resolveRuntimeAuthMode(env);

  if (mode === 'dev-standalone') {
    const developerSessionId = String(env.VITE_NIMI_RUNTIME_DEVELOPER_SESSION_ID || '').trim();
    const developerSessionToken = String(env.VITE_NIMI_RUNTIME_DEVELOPER_SESSION_TOKEN || '').trim();
    runtimeProjection ??= createNimiAppRuntimePlatformClient({
      mode: 'dev-standalone',
      appId,
      developerSession: developerSessionId && developerSessionToken
        ? {
            source: 'runtime-developer-session',
            sessionId: developerSessionId,
            sessionToken: developerSessionToken,
          }
        : null,
    });
    return runtimeProjection;
  }

  if (mode === 'local-first-party') {
    runtimeProjection ??= createNimiAppRuntimePlatformClient({
      mode: 'local-first-party',
      appId,
    });
    return runtimeProjection;
  }

  runtimeProjection ??= createNimiAppRuntimePlatformClient({
    mode: 'third-party-nimi-app',
    appId,
  });
  return runtimeProjection;
}
