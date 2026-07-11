import {
  AccountCallerMode,
  AccountSessionState,
  type AccountCaller,
} from '../core-generated/runtime-typed-client';
import { createNimiClientId, createNimiError } from '../types';
import {
  buildRuntimeAgentRequestContext,
  projectRuntimeLocalAgentIdentity,
  type RuntimeLocalAgentIdentityInput,
  type RuntimeLocalAgentIdentityProjection,
} from './agent-local-identity';
import { createNimiRuntimeAppSessionMetadataProvider } from './app-session';
import { createRuntime } from './index';
import type { RuntimeNodeGrpcTlsOptions, RuntimeNodeGrpcTransportOptions } from './node-grpc';
import { installRuntimeNodeGrpcLocalFirstPartyAuthority } from './node-grpc-authority';
import { assertRuntimeNodeGrpcSensitiveTransport } from './node-grpc-security';
import type { NimiRuntimeAgentPresentationProfileReadProjection } from './runtime-agent-inspect-types';
import {
  createNimiHostRuntimeAgentPresentationProfileSurface,
  type NimiRuntimeAgentPresentationProfileInput,
  type NimiRuntimeAgentPresentationProfileMutationResult,
  type NimiRuntimeAgentPresentationProfilePatchInput,
} from './runtime-agent-presentation';
import { projectNimiRuntimeAgentPresentationRecord } from './runtime-agent-presentation-validation';
import {
  withNimiRuntimeAgentScopes,
  type NimiRuntimeAgentScopeRunner,
} from './runtime-agent-protected';
import { withNimiRuntimeIdempotencyMetadata } from './scenario-jobs';

export interface NimiLocalFirstPartyAgentPresentationClientInput {
  readonly mode: 'first-party-local-app';
  readonly appId: string;
  readonly accountCaller: AccountCaller;
  readonly endpoint?: string;
  readonly tls?: RuntimeNodeGrpcTlsOptions;
}

export interface NimiLocalFirstPartyAgentPresentationClient {
  readonly mode: 'first-party-local-app';
  getPresentationProfile(
    identity: RuntimeLocalAgentIdentityInput,
  ): Promise<NimiRuntimeAgentPresentationProfileReadProjection>;
  setPresentationProfile(
    identity: RuntimeLocalAgentIdentityInput,
    profile: NimiRuntimeAgentPresentationProfileInput | null,
    expectedRevision: string,
  ): Promise<NimiRuntimeAgentPresentationProfileMutationResult>;
  patchPresentationProfile(
    identity: RuntimeLocalAgentIdentityInput,
    patch: NimiRuntimeAgentPresentationProfilePatchInput,
    expectedRevision: string,
  ): Promise<NimiRuntimeAgentPresentationProfileMutationResult>;
}

const SET_PRESENTATION_PROFILE_METHOD =
  '/nimi.runtime.v1.RuntimeAgentService/SetAgentPresentationProfile';

const FORBIDDEN_INPUT_FIELDS = [
  'transport',
  'bridge',
  'authorization',
  'auth',
  'accessToken',
  'tokenProvider',
  'getRuntimeAccountAccessToken',
  'subjectUserId',
  'ownerUserId',
  'refreshToken',
  'sessionToken',
] as const;

const ALLOWED_INPUT_FIELDS = new Set(['mode', 'appId', 'accountCaller', 'endpoint', 'tls']);
const ALLOWED_TLS_FIELDS = new Set(['enabled', 'rootCertPem', 'serverName']);

/**
 * Constructs the only SDK-owned bearer mediation path for Runtime Agent presentation writes.
 * The returned capability cannot reach Runtime, account custody, AI, or streaming surfaces.
 */
export function createNimiLocalFirstPartyAgentPresentationClient(
  input: NimiLocalFirstPartyAgentPresentationClientInput,
): NimiLocalFirstPartyAgentPresentationClient {
  assertClientInput(input);
  const { appId, appInstanceId, deviceId } = projectClientIdentity(input);
  const accountCaller = snapshotAccountCaller(input.accountCaller);
  const nodeTransport = snapshotNodeTransportInput(input);
  const accountRuntime = createRuntime({
    appId,
    transport: nativeNodeTransport(nodeTransport),
  });
  const sessionMetadata = createNimiRuntimeAppSessionMetadataProvider({
    appId,
    appInstanceId,
    deviceId,
    developerRegistration: false,
    auth: accountRuntime.auth,
  });
  const presentationTransport = nativeNodeTransport(nodeTransport);
  assertRuntimeNodeGrpcSensitiveTransport(presentationTransport, SET_PRESENTATION_PROFILE_METHOD);
  installRuntimeNodeGrpcLocalFirstPartyAuthority(presentationTransport, {
    getRuntimeAccountAccessToken: async () => {
      const response = await accountRuntime.account.getAccessToken({
        caller: accountCaller,
        requestedScopes: [],
      }, withNimiRuntimeIdempotencyMetadata(
        { metadata: await sessionMetadata() },
        createNimiClientId('runtime-account-access-token'),
      ));
      const accessToken = normalizeText(response.accessToken);
      if (!response.accepted || !accessToken) {
        throw createNimiError({
          message: 'Runtime-owned account access token is unavailable.',
          reasonCode: 'SDK_RUNTIME_ACCOUNT_ACCESS_TOKEN_UNAVAILABLE',
          actionHint: 'complete_runtime_account_login_or_refresh_projection',
          source: 'runtime',
          details: {
            accepted: response.accepted,
            reasonCode: response.reasonCode,
            accountReasonCode: response.accountReasonCode,
          },
        });
      }
      return accessToken;
    },
  });
  const presentationRuntime = createRuntime({
    appId,
    transport: presentationTransport,
  });
  const protectedRuntime = {
    appId,
    auth: accountRuntime.auth,
    appAuth: accountRuntime.grants,
  };

  const resolveIdentity = async (
    identity: RuntimeLocalAgentIdentityInput,
  ): Promise<{
    readonly identity: RuntimeLocalAgentIdentityProjection;
    readonly subjectUserId: string;
  }> => {
    const projectedIdentity = projectRuntimeLocalAgentIdentity(identity);
    const status = await accountRuntime.account.getAccountSessionStatus({
      caller: accountCaller,
    }, { metadata: await sessionMetadata() });
    const subjectUserId = normalizeText(status.accountProjection?.accountId);
    if (status.state !== AccountSessionState.AUTHENTICATED || !subjectUserId) {
      throw createNimiError({
        message: 'Runtime account projection is not authenticated for Agent presentation.',
        reasonCode: 'SDK_RUNTIME_ACCOUNT_SUBJECT_UNAVAILABLE',
        actionHint: 'complete_runtime_account_login_or_refresh_projection',
        source: 'runtime',
      });
    }
    if (projectedIdentity.ownerUserId !== subjectUserId) {
      throw createNimiError({
        message: 'Runtime Agent owner does not match the authenticated Runtime account projection.',
        reasonCode: 'SDK_RUNTIME_AGENT_OWNER_ACCOUNT_MISMATCH',
        actionHint: 'use_authenticated_runtime_account_agent_identity',
        source: 'sdk',
      });
    }
    return { identity: projectedIdentity, subjectUserId };
  };

  const scopeRunner = (subjectUserId: string): NimiRuntimeAgentScopeRunner =>
    (scopes, operation) => withNimiRuntimeAgentScopes({
      runtime: protectedRuntime,
      subjectUserId,
    }, scopes, async (options) => {
      const appSessionMetadata = await sessionMetadata();
      const idempotentOptions = withNimiRuntimeIdempotencyMetadata(
        options,
        createNimiClientId('runtime-agent-presentation'),
      );
      return operation({
        ...idempotentOptions,
        metadata: {
          ...appSessionMetadata,
          ...(idempotentOptions.metadata ?? {}),
        },
      });
    });

  const mutationSurface = (subjectUserId: string) =>
    createNimiHostRuntimeAgentPresentationProfileSurface({
      getRuntime: () => ({
        appId,
        auth: accountRuntime.auth,
        appAuth: accountRuntime.grants,
        agent: presentationRuntime.agents,
      }),
      getSubjectUserId: () => subjectUserId,
      withScopes: scopeRunner(subjectUserId),
    });

  return {
    mode: 'first-party-local-app',
    async getPresentationProfile(identity) {
      const resolved = await resolveIdentity(identity);
      const response = await scopeRunner(resolved.subjectUserId)(['runtime.agent.read'], (options) =>
        presentationRuntime.agents.getAgent({
          context: buildRuntimeAgentRequestContext({
            runtimeAppId: appId,
            subjectUserId: resolved.subjectUserId,
            ...resolved.identity,
          }),
          agentId: resolved.identity.localAgentRef,
        }, options));
      const projection = projectNimiRuntimeAgentPresentationRecord(response.agent);
      if (projection.committedRevision === null) {
        throw createNimiError({
          message: 'Runtime returned an invalid Agent presentation profile projection.',
          reasonCode: 'SDK_RUNTIME_AGENT_PRESENTATION_RESPONSE_INVALID',
          actionHint: 'inspect_runtime_agent_presentation_response',
          source: 'runtime',
        });
      }
      return projection;
    },
    async setPresentationProfile(identity, profile, expectedRevision) {
      const resolved = await resolveIdentity(identity);
      return mutationSurface(resolved.subjectUserId).setPresentationProfile(
        resolved.identity,
        profile,
        expectedRevision,
      );
    },
    async patchPresentationProfile(identity, patch, expectedRevision) {
      const resolved = await resolveIdentity(identity);
      return mutationSurface(resolved.subjectUserId).patchPresentationProfile(
        resolved.identity,
        patch,
        expectedRevision,
      );
    },
  };
}

function nativeNodeTransport(
  input: Readonly<Pick<NimiLocalFirstPartyAgentPresentationClientInput, 'endpoint' | 'tls'>>,
): RuntimeNodeGrpcTransportOptions & { readonly type: 'node-grpc' } {
  return Object.freeze({
    type: 'node-grpc',
    endpoint: input.endpoint,
    tls: input.tls,
  });
}

function snapshotNodeTransportInput(
  input: NimiLocalFirstPartyAgentPresentationClientInput,
): Readonly<Pick<NimiLocalFirstPartyAgentPresentationClientInput, 'endpoint' | 'tls'>> {
  const tls = input.tls === undefined
    ? undefined
    : Object.freeze({
      enabled: input.tls.enabled,
      rootCertPem: input.tls.rootCertPem,
      serverName: input.tls.serverName,
    });
  return Object.freeze({ endpoint: input.endpoint, tls });
}

function snapshotAccountCaller(caller: AccountCaller): AccountCaller {
  const scopes = [...caller.scopes];
  Object.freeze(scopes);
  return Object.freeze({
    appId: caller.appId,
    appInstanceId: caller.appInstanceId,
    deviceId: caller.deviceId,
    mode: caller.mode,
    scopes,
    launchHostId: typeof caller.launchHostId === 'string' ? caller.launchHostId : '',
    launchNonce: typeof caller.launchNonce === 'string' ? caller.launchNonce : '',
    releaseDescriptorRef: typeof caller.releaseDescriptorRef === 'string' ? caller.releaseDescriptorRef : '',
  });
}

function projectClientIdentity(input: NimiLocalFirstPartyAgentPresentationClientInput): {
  readonly appId: string;
  readonly appInstanceId: string;
  readonly deviceId: string;
} {
  if (input.mode !== 'first-party-local-app') {
    throw createNimiError({
      message: 'Local first-party Agent presentation requires mode first-party-local-app.',
      reasonCode: 'SDK_RUNTIME_LOCAL_FIRST_PARTY_MODE_REQUIRED',
      actionHint: 'use_first_party_local_app_runtime_mode',
      source: 'sdk',
    });
  }
  const appId = normalizeText(input.appId);
  if (!appId) {
    throw createNimiError({
      message: 'Local first-party Runtime construction requires appId.',
      reasonCode: 'SDK_RUNTIME_APP_ID_REQUIRED',
      actionHint: 'provide_runtime_app_id',
      source: 'sdk',
    });
  }
  if (!input.accountCaller || typeof input.accountCaller !== 'object') {
    throw createNimiError({
      message: 'Local first-party Agent presentation requires a Runtime-owned account caller projection.',
      reasonCode: 'SDK_RUNTIME_ACCOUNT_CALLER_REQUIRED',
      actionHint: 'create_runtime_account_caller_projection',
      source: 'sdk',
    });
  }
  const callerAppId = normalizeText(input.accountCaller.appId);
  const appInstanceId = normalizeText(input.accountCaller.appInstanceId);
  const deviceId = normalizeText(input.accountCaller.deviceId);
  const scopes = input.accountCaller.scopes;
  const launchFields = [
    input.accountCaller.launchHostId,
    input.accountCaller.launchNonce,
    input.accountCaller.releaseDescriptorRef,
  ];
  if (
    input.accountCaller.mode !== AccountCallerMode.LOCAL_FIRST_PARTY_APP
    || typeof input.accountCaller.appId !== 'string'
    || typeof input.accountCaller.appInstanceId !== 'string'
    || typeof input.accountCaller.deviceId !== 'string'
    || callerAppId !== input.accountCaller.appId
    || appInstanceId !== input.accountCaller.appInstanceId
    || deviceId !== input.accountCaller.deviceId
    || callerAppId !== appId
    || !appInstanceId
    || !deviceId
    || !Array.isArray(scopes)
    || scopes.some((scope) => typeof scope !== 'string' || !scope || scope.trim() !== scope)
    || new Set(scopes).size !== scopes.length
    || launchFields.some((field) => field !== undefined && (typeof field !== 'string' || field !== ''))
  ) {
    throw createNimiError({
      message: 'Local first-party Agent presentation requires a matching admitted local account caller.',
      reasonCode: 'SDK_RUNTIME_ACCOUNT_CALLER_INVALID',
      actionHint: 'create_matching_local_first_party_runtime_account_caller',
      source: 'sdk',
    });
  }
  return { appId, appInstanceId, deviceId };
}

function assertClientInput(input: unknown): asserts input is NimiLocalFirstPartyAgentPresentationClientInput {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw createNimiError({
      message: 'Local first-party Agent presentation construction requires an input object.',
      reasonCode: 'SDK_RUNTIME_AGENT_PRESENTATION_INPUT_INVALID',
      actionHint: 'provide_local_first_party_agent_presentation_input',
      source: 'sdk',
    });
  }
  const candidate = input as Readonly<Record<string, unknown>>;
  const forbiddenField = FORBIDDEN_INPUT_FIELDS.find((field) =>
    Object.prototype.hasOwnProperty.call(candidate, field));
  if (forbiddenField) {
    throw createNimiError({
      message: `Local first-party Agent presentation rejects caller-controlled ${forbiddenField}.`,
      reasonCode: 'SDK_TRANSPORT_INVALID',
      actionHint: 'use_native_node_grpc_for_agent_presentation',
      source: 'sdk',
    });
  }
  const unsupportedField = Object.keys(candidate).find((field) => !ALLOWED_INPUT_FIELDS.has(field));
  if (unsupportedField) {
    throw createNimiError({
      message: `Local first-party Agent presentation input does not admit ${unsupportedField}.`,
      reasonCode: 'SDK_RUNTIME_AGENT_PRESENTATION_INPUT_INVALID',
      actionHint: 'use_presentation_endpoint_and_tls_input_only',
      source: 'sdk',
    });
  }
  if (candidate.endpoint !== undefined && typeof candidate.endpoint !== 'string') {
    throw createNimiError({
      message: 'Local first-party Agent presentation endpoint must be a string.',
      reasonCode: 'SDK_TRANSPORT_INVALID',
      actionHint: 'provide_native_node_grpc_endpoint',
      source: 'sdk',
    });
  }
  if (
    candidate.tls !== undefined
    && (!candidate.tls || typeof candidate.tls !== 'object' || Array.isArray(candidate.tls))
  ) {
    throw createNimiError({
      message: 'Local first-party Agent presentation TLS options are invalid.',
      reasonCode: 'SDK_TRANSPORT_INVALID',
      actionHint: 'provide_native_node_grpc_tls_options',
      source: 'sdk',
    });
  }
  if (candidate.tls && typeof candidate.tls === 'object') {
    const tls = candidate.tls as Readonly<Record<string, unknown>>;
    const unsupportedTlsField = Object.keys(tls).find((field) => !ALLOWED_TLS_FIELDS.has(field));
    if (
      unsupportedTlsField
      || (tls.enabled !== undefined && typeof tls.enabled !== 'boolean')
      || (tls.rootCertPem !== undefined && typeof tls.rootCertPem !== 'string')
      || (tls.serverName !== undefined && typeof tls.serverName !== 'string')
    ) {
      throw createNimiError({
        message: 'Local first-party Agent presentation TLS options are invalid.',
        reasonCode: 'SDK_TRANSPORT_INVALID',
        actionHint: 'provide_native_node_grpc_tls_options',
        source: 'sdk',
      });
    }
  }
}

function normalizeText(value: unknown): string {
  return String(value || '').trim();
}
