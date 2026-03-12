import { Realm } from '@nimiplatform/sdk/realm';
import { Runtime } from '@nimiplatform/sdk/runtime';

const DEFAULT_APP_ID = 'nimi.desktop';

export type PlatformClient = {
  runtime: Runtime;
  realm: Realm;
};

let platformClient: PlatformClient | null = null;

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

  const runtime = new Runtime({
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
  const realm = new Realm({
    baseUrl: String(input.realmBaseUrl || '').trim(),
    auth: tokenValue ? {
      accessToken: tokenValue,
    } : null,
  });
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
