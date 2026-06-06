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
import { createNimiError } from '../types';
import { normalizeNimiRuntimeAgentText, toNimiRuntimeTimestamp } from './runtime-agent-values';

const RUNTIME_AGENT_SCOPE_CATALOG_VERSION = 'sdk-vnext';
const RUNTIME_AGENT_TOKEN_TTL_SECONDS = 3600;

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

async function issueNimiRuntimeAgentCallOptions(input: {
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
  });
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
    externalPrincipalId: input.runtime.appId,
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
  }, {
    metadata: { domain: 'app-auth' },
  });
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
      'x-nimi-protected-access-token-id': tokenId,
      'x-nimi-protected-access-secret': secret,
    },
  };
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
  return operation(await issueNimiRuntimeAgentCallOptions({
    runtime: input.runtime,
    subjectUserId: input.subjectUserId,
    scopes,
  }));
}
