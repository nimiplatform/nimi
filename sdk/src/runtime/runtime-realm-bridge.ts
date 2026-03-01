import type {
  RuntimeAuthMaterial,
  RuntimeRealmBridgeContext,
  RuntimeRealmBridgeHelpers,
} from './types.js';

const DEFAULT_REALM_GRANT_PATH = '/api/creator/mods/control/grants/issue';

type FetchRealmGrantInput = {
  appId?: string;
  subjectUserId: string;
  scopes: string[];
  path?: string;
};

type FetchRealmGrantOutput = {
  token: string;
  version: string;
  expiresAt?: string;
};

type RealmGrantResponse = {
  token?: unknown;
  version?: unknown;
  expiresAt?: unknown;
};

function normalizeText(value: unknown): string {
  return String(value || '').trim();
}

function ensureText(value: unknown, field: string): string {
  const normalized = normalizeText(value);
  if (!normalized) {
    throw new Error(`${field} is required`);
  }
  return normalized;
}

function toStringArray(values: string[]): string[] {
  return values
    .map((value) => normalizeText(value))
    .filter((value) => value.length > 0);
}

export async function fetchRealmGrant(
  context: RuntimeRealmBridgeContext,
  input: FetchRealmGrantInput,
): Promise<FetchRealmGrantOutput> {
  const appId = normalizeText(input.appId) || ensureText(context.appId, 'appId');
  const subjectUserId = ensureText(input.subjectUserId, 'subjectUserId');
  const scopes = toStringArray(input.scopes || []);
  if (scopes.length === 0) {
    throw new Error('scopes is required');
  }
  const path = normalizeText(input.path) || DEFAULT_REALM_GRANT_PATH;

  const response = await context.realm.raw.request<RealmGrantResponse>({
    method: 'POST',
    path,
    body: {
      appId,
      subjectUserId,
      scopes,
    },
  });

  const token = ensureText(response?.token, 'token');
  const version = ensureText(response?.version, 'version');
  const expiresAt = normalizeText(response?.expiresAt) || undefined;
  return {
    token,
    version,
    expiresAt,
  };
}

export function buildRuntimeAuthMetadata(input: RuntimeAuthMaterial): Record<string, string> {
  const metadata: Record<string, string> = {};
  const grantToken = normalizeText(input.grantToken);
  const grantVersion = normalizeText(input.grantVersion);
  if (grantToken) {
    metadata.realmGrantToken = grantToken;
  }
  if (grantVersion) {
    metadata.realmGrantVersion = grantVersion;
  }
  return metadata;
}

export function linkRuntimeTraceToRealmWrite(input: {
  runtimeTraceId?: string;
  realmPayload: Record<string, unknown>;
}): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    ...input.realmPayload,
  };
  const existingTraceId = normalizeText(payload.traceId);
  if (existingTraceId) {
    return payload;
  }
  const runtimeTraceId = normalizeText(input.runtimeTraceId);
  if (runtimeTraceId) {
    payload.traceId = runtimeTraceId;
  }
  return payload;
}

export function createRuntimeRealmBridgeHelpers(
  context: RuntimeRealmBridgeContext,
): RuntimeRealmBridgeHelpers {
  return {
    fetchRealmGrant: async (input) => fetchRealmGrant(context, input),
    buildRuntimeAuthMetadata,
    linkRuntimeTraceToRealmWrite,
  };
}

