import {
  AppMode,
  AuthorizationPreset,
  ExternalPrincipalType,
  PolicyMode,
  WorldRelation,
  type AuthorizeExternalPrincipalRequest,
  type AuthorizeExternalPrincipalResponse,
  type RegisterAppRequest,
  type RegisterAppResponse,
  type RuntimeTypedCallOptions,
} from '../core-generated/runtime-typed-client';
import { createNimiClientId, createNimiError } from '../types';
import { withNimiRuntimeIdempotencyMetadata } from './scenario-jobs';
import { normalizeNimiRuntimeAgentText, toNimiRuntimeTimestamp } from './runtime-agent-values';

const RUNTIME_AGENT_SCOPE_CATALOG_VERSION = 'sdk-v2';
const RUNTIME_AGENT_TOKEN_TTL_SECONDS = 3600;
const RUNTIME_AGENT_PROTECTED_PRINCIPAL_SUFFIX = 'runtime-agent';

export interface NimiRuntimeAgentAuthClient {
  registerApp(request: RegisterAppRequest, options?: RuntimeTypedCallOptions): Promise<RegisterAppResponse>;
}

export interface NimiRuntimeAgentAppAuthClient {
  authorizeExternalPrincipal(
    request: AuthorizeExternalPrincipalRequest,
    options?: RuntimeTypedCallOptions,
  ): Promise<AuthorizeExternalPrincipalResponse>;
}

export interface NimiRuntimeAgentProtectedRuntime {
  readonly appId: string;
  readonly auth: NimiRuntimeAgentAuthClient;
  readonly appAuth: NimiRuntimeAgentAppAuthClient;
}

export type NimiRuntimeAgentScopeRunner = <T>(
  scopes: readonly string[],
  operation: (options: RuntimeTypedCallOptions) => Promise<T>,
) => Promise<T>;

export interface NimiRuntimeAgentProtectedOptions {
  readonly getSubjectUserId: () => string | Promise<string | undefined> | undefined;
  readonly withScopes?: NimiRuntimeAgentScopeRunner;
}

export async function resolveNimiRuntimeAgentSubjectUserId(
  getSubjectUserId: () => string | Promise<string | undefined> | undefined,
  message: string,
): Promise<string> {
  const subjectUserId = normalizeNimiRuntimeAgentText(await getSubjectUserId());
  if (!subjectUserId) {
    throw createNimiError({
      message,
      reasonCode: 'SDK_RUNTIME_AGENT_SUBJECT_REQUIRED',
      actionHint: 'provide_runtime_agent_subject_user_id',
      source: 'sdk',
    });
  }
  return subjectUserId;
}

function normalizeScopes(scopes: readonly string[]): string[] {
  return [...new Set(scopes.map((scope) => normalizeNimiRuntimeAgentText(scope)).filter(Boolean))].sort();
}

export async function issueNimiRuntimeAgentProtectedCallOptions(input: {
  readonly runtime: NimiRuntimeAgentProtectedRuntime;
  readonly subjectUserId: string;
  readonly scopes: readonly string[];
}): Promise<RuntimeTypedCallOptions> {
  const scopes = normalizeScopes(input.scopes);
  if (scopes.length === 0) {
    return {};
  }
  const appInstanceId = `${input.runtime.appId}.runtime-agent`;
  const registration = await input.runtime.auth.registerApp({
    appId: input.runtime.appId,
    appInstanceId,
    deviceId: 'runtime-agent',
    appVersion: '1',
    capabilities: [],
    developerRegistration: false,
    modeManifest: {
      appMode: AppMode.FULL,
      runtimeRequired: true,
      realmRequired: true,
      worldRelation: WorldRelation.NONE,
    },
  }, withNimiRuntimeIdempotencyMetadata(
    undefined,
    createNimiClientId('runtime-agent-protected-register'),
  ));
  if (!registration.accepted) {
    throw createNimiError({
      message: 'Runtime Agent protected access registration was rejected.',
      reasonCode: 'SDK_RUNTIME_AGENT_PROTECTED_ACCESS_REJECTED',
      actionHint: 'register_runtime_app_first',
      source: 'runtime',
    });
  }
  const token = await input.runtime.appAuth.authorizeExternalPrincipal({
    domain: 'app-auth',
    appId: input.runtime.appId,
    externalPrincipalId: runtimeAgentProtectedExternalPrincipalId(input.runtime.appId),
    externalPrincipalType: ExternalPrincipalType.APP,
    subjectUserId: input.subjectUserId,
    consentId: 'runtime-agent',
    consentVersion: 'v1',
    decisionAt: toNimiRuntimeTimestamp(new Date()),
    policyVersion: 'runtime-agent-v1',
    policyMode: PolicyMode.CUSTOM,
    preset: AuthorizationPreset.UNSPECIFIED,
    scopes,
    resourceSelectors: { conversationIds: [], messageIds: [], documentIds: [], labels: {} },
    canDelegate: false,
    maxDelegationDepth: 0,
    ttlSeconds: RUNTIME_AGENT_TOKEN_TTL_SECONDS,
    scopeCatalogVersion: RUNTIME_AGENT_SCOPE_CATALOG_VERSION,
    policyOverride: false,
  }, withNimiRuntimeIdempotencyMetadata(
    { metadata: { domain: 'app-auth' } },
    createNimiClientId(`runtime-agent-protected-authorize-${protectedScopeSignature(scopes)}`),
  ));
  const tokenId = normalizeNimiRuntimeAgentText(token.tokenId);
  const secret = normalizeNimiRuntimeAgentText(token.secret);
  if (!tokenId || !secret) {
    throw createNimiError({
      message: 'Runtime Agent protected access token response is missing credentials.',
      reasonCode: 'SDK_RUNTIME_AGENT_PROTECTED_ACCESS_INVALID',
      actionHint: 'check_runtime_app_auth_response',
      source: 'runtime',
    });
  }
  return {
    metadata: {
      'x-nimi-access-token-id': tokenId,
      'x-nimi-access-token-secret': secret,
    },
  };
}

function runtimeAgentProtectedExternalPrincipalId(appId: string): string {
  return `${appId}.${RUNTIME_AGENT_PROTECTED_PRINCIPAL_SUFFIX}`;
}

function protectedScopeSignature(scopes: readonly string[]): string {
  let hash = 0x811c9dc5;
  for (const scope of scopes) {
    for (let index = 0; index < scope.length; index += 1) {
      hash ^= scope.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    hash ^= 0x7c;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `s${scopes.length}-${hash.toString(36)}`;
}

export async function withNimiRuntimeAgentScopes<T>(
  input: {
    readonly runtime: NimiRuntimeAgentProtectedRuntime;
    readonly subjectUserId: string;
    readonly withScopes?: NimiRuntimeAgentScopeRunner;
  },
  scopes: readonly string[],
  operation: (options: RuntimeTypedCallOptions) => Promise<T>,
): Promise<T> {
  if (input.withScopes) {
    return input.withScopes(scopes, operation);
  }
  return operation(await issueNimiRuntimeAgentProtectedCallOptions({
    runtime: input.runtime,
    subjectUserId: input.subjectUserId,
    scopes,
  }));
}
