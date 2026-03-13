import type { Realm } from '@nimiplatform/sdk/realm';
import type { Runtime } from '@nimiplatform/sdk/runtime';

const DEFAULT_APP_ID = 'nimi.realm-drift';

export type PlatformClient = {
  runtime: Runtime;
  realm: Realm;
};

let platformClient: PlatformClient | null = null;
let runtimeSdkModulePromise: Promise<typeof import('@nimiplatform/sdk/runtime')> | null = null;
let realmSdkModulePromise: Promise<typeof import('@nimiplatform/sdk/realm')> | null = null;

async function loadRuntimeSdkModule(): Promise<typeof import('@nimiplatform/sdk/runtime')> {
  if (!runtimeSdkModulePromise) {
    runtimeSdkModulePromise = import('@nimiplatform/sdk/runtime');
  }
  return runtimeSdkModulePromise;
}

async function loadRealmSdkModule(): Promise<typeof import('@nimiplatform/sdk/realm')> {
  if (!realmSdkModulePromise) {
    realmSdkModulePromise = import('@nimiplatform/sdk/realm');
  }
  return realmSdkModulePromise;
}

export type PlatformClientRuntimeDefaults = {
  realmBaseUrl: string;
  accessToken?: string;
  accessTokenProvider?: () => string | Promise<string>;
  subjectUserIdProvider?: () => string | Promise<string>;
};

function normalizeText(value: unknown): string {
  return String(value || '').trim();
}

async function resolveAccessToken(
  input: string | (() => string | Promise<string>),
): Promise<string> {
  if (typeof input === 'function') {
    return normalizeText(await input());
  }
  return normalizeText(input);
}

function decodeBase64UrlUtf8(input: string): string {
  const normalized = normalizeText(input).replace(/-/g, '+').replace(/_/g, '/');
  if (!normalized) {
    return '';
  }
  const paddingLength = (4 - (normalized.length % 4)) % 4;
  const padded = `${normalized}${'='.repeat(paddingLength)}`;

  if (typeof Buffer !== 'undefined') {
    return Buffer.from(padded, 'base64').toString('utf8');
  }

  if (typeof atob === 'function') {
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    if (typeof TextDecoder !== 'undefined') {
      return new TextDecoder('utf-8').decode(bytes);
    }
    return String.fromCharCode(...bytes);
  }

  return '';
}

function decodeJwtSubject(accessToken: string): string {
  const normalizedToken = normalizeText(accessToken);
  if (!normalizedToken) {
    return '';
  }

  const rawToken = normalizedToken.toLowerCase().startsWith('bearer ')
    ? normalizeText(normalizedToken.slice(7))
    : normalizedToken;
  const parts = rawToken.split('.');
  if (parts.length < 2) {
    return '';
  }

  try {
    const payloadText = decodeBase64UrlUtf8(parts[1] || '');
    if (!payloadText) {
      return '';
    }
    const payload = JSON.parse(payloadText) as Record<string, unknown>;
    return normalizeText(payload.sub);
  } catch {
    return '';
  }
}

export async function initializePlatformClient(input: PlatformClientRuntimeDefaults): Promise<PlatformClient> {
  const [runtimeSdk, realmSdk] = await Promise.all([
    loadRuntimeSdkModule(),
    loadRealmSdkModule(),
  ]);
  const tokenValue = String(input.accessToken || '').trim();
  const runtimeAccessTokenProvider = input.accessTokenProvider || tokenValue;
  const runtimeSubjectUserIdProvider = async () => {
    const explicit = normalizeText(await input.subjectUserIdProvider?.());
    if (explicit) {
      return explicit;
    }
    const accessToken = await resolveAccessToken(runtimeAccessTokenProvider);
    return decodeJwtSubject(accessToken);
  };

  const runtime = new runtimeSdk.Runtime({
    appId: DEFAULT_APP_ID,
    transport: {
      type: 'tauri-ipc',
      commandNamespace: 'runtime_bridge',
      eventNamespace: 'runtime_bridge',
    },
    auth: {
      accessToken: runtimeAccessTokenProvider,
    },
    subjectContext: {
      getSubjectUserId: runtimeSubjectUserIdProvider,
    },
  });
  const realm = new realmSdk.Realm({
    baseUrl: String(input.realmBaseUrl || '').trim(),
    auth: tokenValue
      ? {
          accessToken: tokenValue,
        }
      : null,
  });

  // Install 401 response interceptor for automatic token refresh
  installTokenRefreshInterceptor(realm, input);

  const client: PlatformClient = {
    runtime,
    realm,
  };
  platformClient = client;
  return client;
}

export function getPlatformClient(): PlatformClient {
  if (!platformClient) {
    throw new Error('PLATFORM_CLIENT_NOT_READY');
  }
  return platformClient;
}

function installTokenRefreshInterceptor(
  realm: InstanceType<typeof import('@nimiplatform/sdk/realm').Realm>,
  input: PlatformClientRuntimeDefaults,
): void {
  const originalRequest = realm.raw?.request?.bind(realm.raw);
  if (!originalRequest) return;

  let refreshPromise: Promise<string | null> | null = null;

  realm.raw.request = async function interceptedRequest<T>(
    ...args: Parameters<typeof originalRequest>
  ): Promise<T> {
    try {
      return await originalRequest<T>(...args);
    } catch (err: unknown) {
      const status = (err as Record<string, unknown>)?.status ?? (err as Record<string, unknown>)?.statusCode;
      if (status !== 401) throw err;

      if (!refreshPromise) {
        refreshPromise = attemptTokenRefresh(realm, input).finally(() => {
          refreshPromise = null;
        });
      }

      const newToken = await refreshPromise;
      if (!newToken) throw err;

      return await originalRequest<T>(...args);
    }
  };
}

async function attemptTokenRefresh(
  realm: InstanceType<typeof import('@nimiplatform/sdk/realm').Realm>,
  _input: PlatformClientRuntimeDefaults,
): Promise<string | null> {
  try {
    const { useAppStore } = await import('@renderer/app-shell/app-store.js');
    const store = useAppStore.getState();
    const { refreshToken } = store.auth;

    if (!refreshToken) return null;

    const data = await realm.raw.request<Record<string, unknown>>({
      method: 'POST',
      path: '/api/auth/refresh',
      body: { refreshToken },
    });

    const newToken = String(data.accessToken || '');
    const newRefreshToken = String(data.refreshToken || refreshToken);

    if (!newToken) {
      store.clearAuthSession();
      return null;
    }

    if (store.auth.user) {
      store.setAuthSession(store.auth.user, newToken, newRefreshToken);
    }

    const realmAny = realm as unknown as Record<string, unknown>;
    if (realmAny.config) {
      (realmAny.config as Record<string, unknown>).auth = { accessToken: newToken };
    }

    return newToken;
  } catch {
    const { useAppStore } = await import('@renderer/app-shell/app-store.js');
    useAppStore.getState().clearAuthSession();
    return null;
  }
}
