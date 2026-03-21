import type {
  RuntimeAuthMaterial,
  RuntimeRealmBridgeContext,
  RuntimeRealmBridgeHelpers,
} from './types.js';
import { createNimiError } from './errors.js';
import { normalizeText, ensureText } from './helpers.js';
import { ReasonCode } from '../types/index.js';

type FetchRealmGrantInput = {
  subjectUserId: string;
  scopes: string[];
};

type FetchRealmGrantOutput = {
  token: string;
  version: string;
  expiresAt: string;
};

function toStringArray(values: string[]): string[] {
  return values
    .map((value) => normalizeText(value))
    .filter((value) => value.length > 0);
}

export async function fetchRealmGrant(
  context: RuntimeRealmBridgeContext,
  input: FetchRealmGrantInput,
): Promise<FetchRealmGrantOutput> {
  const appId = ensureText(context.appId, 'appId');
  const subjectUserId = ensureText(input.subjectUserId, 'subjectUserId');
  const scopes = toStringArray(input.scopes || []);
  if (scopes.length === 0) {
    throw createNimiError({
      message: 'scopes is required',
      reasonCode: ReasonCode.APP_SCOPE_MANIFEST_INVALID,
      actionHint: 'provide_runtime_grant_scopes',
      source: 'sdk',
    });
  }

  const response = await context.realm.services.RuntimeRealmGrantsService.issueRuntimeRealmGrant({
      appId,
      subjectUserId,
      scopes,
  });

  const token = ensureText(response.token, 'token');
  const version = ensureText(response.version, 'version');
  const expiresAt = ensureText(response.expiresAt, 'expiresAt');
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

export function createRuntimeRealmBridgeHelpers(
  context: RuntimeRealmBridgeContext,
): RuntimeRealmBridgeHelpers {
  return {
    fetchRealmGrant: async (input) => fetchRealmGrant(context, input),
    buildRuntimeAuthMetadata,
  };
}
