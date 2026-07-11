import { randomUUID } from 'node:crypto';

import type { CoreTransport } from '../core-client';
import type {
  AccountCaller,
  AppModeManifest,
  ConversationAnchorSnapshot,
  RegisterAppResponse,
  SendAppMessageResponse,
} from '../core-generated/runtime-typed-client';
import {
  AccountCallerMode,
  AccountSessionState,
  AppMode,
  ReasonCode,
  WorldRelation,
} from '../core-generated/runtime-typed-client';
import type { NimiRealmSocialApi } from '../realm/social';
import type { CoreStreamRequest, CoreUnaryRequest } from '../types';
import { Runtime } from './index';
import { installRuntimeNodeGrpcLocalFirstPartyAuthority } from './node-grpc-authority';
import {
  createNimiDeveloperRegisteredRuntimeAccountCaller,
  createNimiLocalFirstPartyRuntimeAccountCaller,
} from './account-caller';
import {
  createNimiRuntimeAppSessionMetadataProvider,
  type NimiRuntimeAppSessionMetadataProvider,
} from './app-session';
import {
  createNimiRuntimeAgentClient,
  type NimiRuntimeAgentClientRuntime,
} from './runtime-agent-client';
import {
  type NimiRuntimeAgentPresentationProfileInput,
  type NimiRuntimeAgentPresentationProfileMutationResult,
} from './runtime-agent-presentation';
import {
  type RuntimeLocalAgentIdentityInput,
} from './agent-local-identity';
import type { NimiLocalFirstPartyAgentPresentationClient } from './local-first-party-agent-presentation';
import type { NimiRuntimeAgentInitializedLocalAgent } from './runtime-agent-lifecycle';
import type { NimiRuntimeAgentMaterializedRealmSource } from './runtime-agent-materialization';
import {
  withNimiRuntimeAgentScopes,
  type NimiRuntimeAgentProtectedRuntime,
  type NimiRuntimeAgentScopeRunner,
} from './runtime-agent-protected';
import {
  DESKTOP_APP_ID,
  DESKTOP_APP_INSTANCE_ID,
  DESKTOP_DEVICE_ID,
  OWNER_USER_ID,
  REALM_STUDIO_DEVICE_ID,
  REALM_WORLD_STUDIO_APP_ID,
  REALM_WORLD_STUDIO_APP_INSTANCE_ID,
  RUNTIME_ACCOUNT_REDIRECT_URI,
  RUNTIME_SOURCE_REF,
  SOURCE_REF,
  type RuntimeAgentLiveE2EDeveloperRegisteredAccountInput,
  liveIdempotencyOptions,
  normalizeStrings,
  normalizeText,
  requireText,
} from './runtime-agent-live-e2e-fixture-shared.test-helper';

// Fixture turns never carry execution bindings: the runtime resolves each
// turn against the committed agent AI Config (K-AGCORE-147). Flows
// that need a non-default model must first commit it through
// agentClient.agentAIConfig.upsert.
export async function sendFixtureTurn(input: {
  readonly agentClient: ReturnType<typeof createNimiRuntimeAgentClient>;
  readonly localAgent: NimiRuntimeAgentInitializedLocalAgent;
  readonly conversationAnchorId: string;
  readonly text: string;
}): Promise<SendAppMessageResponse> {
  return input.agentClient.sendTurn({
    ownerUserId: OWNER_USER_ID,
    runtimeSourceRef: RUNTIME_SOURCE_REF,
    localAgentRef: input.localAgent.localAgentRef,
    conversationAnchorId: input.conversationAnchorId,
    requestId: `runtime-agent-live-e2e-turn:${randomUUID()}`,
    messages: [{
      role: 'user',
      content: normalizeText(input.text) || 'hello from runtime-agent-live-e2e',
    }],
  });
}

export async function materializeFixtureLocalAgent(input: {
  readonly agentClient: ReturnType<typeof createNimiRuntimeAgentClient>;
  readonly realm: Pick<NimiRealmSocialApi, 'generated'>;
}): Promise<{
  readonly materialization: NimiRuntimeAgentMaterializedRealmSource;
  readonly localAgent: NimiRuntimeAgentInitializedLocalAgent;
}> {
  const materialization = await input.agentClient.materialize({
    sourceRef: SOURCE_REF,
    requestId: `runtime-agent-live-materialization:${randomUUID()}`,
    realm: input.realm,
    emitRealmDataError() {},
  });
  const discovered = await input.agentClient.discoverBySource({
    ownerUserId: OWNER_USER_ID,
    runtimeSourceRef: RUNTIME_SOURCE_REF,
    sourceRef: SOURCE_REF,
  });
  const agent = discovered.find((candidate) => candidate.localAgentRef === materialization.localAgentRef);
  if (!agent) {
    throw new Error('Runtime materialization commit did not appear in bounded LocalAgent inventory.');
  }
  return {
    materialization,
    localAgent: {
      localAgentRef: agent.localAgentRef,
      ownerUserId: agent.ownerUserId,
      runtimeSourceRef: agent.runtimeSourceRef,
      agent: agent.agent,
    },
  };
}

export async function openFixtureConversation(input: {
  readonly agentClient: ReturnType<typeof createNimiRuntimeAgentClient>;
  readonly localAgent: NimiRuntimeAgentInitializedLocalAgent;
}): Promise<ConversationAnchorSnapshot> {
  return input.agentClient.openConversation({
    ownerUserId: OWNER_USER_ID,
    runtimeSourceRef: RUNTIME_SOURCE_REF,
    localAgentRef: input.localAgent.localAgentRef,
    metadata: {
      appId: DESKTOP_APP_ID,
      surface: 'sdk.runtime-agent-live-e2e',
    },
  });
}

export function createFixtureRuntimeAgentClient(
  runtime: Runtime,
): ReturnType<typeof createNimiRuntimeAgentClient> {
  const agentRuntime = runtimeAgentClientRuntime(runtime, DESKTOP_APP_ID);
  const sessionMetadata = createNimiRuntimeAppSessionMetadataProvider({
    appId: DESKTOP_APP_ID,
    appInstanceId: DESKTOP_APP_INSTANCE_ID,
    deviceId: DESKTOP_DEVICE_ID,
    appVersion: 'sdk-runtime-agent-live-e2e',
    developerRegistration: false,
    auth: runtime.auth,
  });
  return createNimiRuntimeAgentClient({
    runtime: agentRuntime,
    appId: DESKTOP_APP_ID,
    getSubjectUserId: () => OWNER_USER_ID,
    withScopes: runtimeAgentLiveScopeRunner(agentRuntime, sessionMetadata),
  });
}

export async function setFixtureRuntimeAgentPresentationProfile(input: {
  readonly presentation: NimiLocalFirstPartyAgentPresentationClient;
  readonly identity: RuntimeLocalAgentIdentityInput;
  readonly profile: NimiRuntimeAgentPresentationProfileInput;
}): Promise<NimiRuntimeAgentPresentationProfileMutationResult> {
  const current = await input.presentation.getPresentationProfile(input.identity);
  if (current.committedRevision === null) {
    throw new Error('Runtime Agent live fixture received an invalid presentation revision from typed AgentRecord.');
  }
  return input.presentation.setPresentationProfile(
    input.identity,
    input.profile,
    current.committedRevision,
  );
}

export function requireConversationAnchorId(conversation: ConversationAnchorSnapshot): string {
  const anchorId = normalizeText(conversation.anchor?.conversationAnchorId);
  if (!anchorId) {
    throw new Error(`Runtime Agent openConversation returned no anchor id: ${JSON.stringify(conversation)}`);
  }
  return anchorId;
}

export function createRuntimeForEndpoint(
  endpoint: string,
  appId: string,
  getRuntimeAccountAccessToken?: () => Promise<string>,
): Runtime {
  const transport = {
    type: 'node-grpc' as const,
    endpoint,
  };
  if (getRuntimeAccountAccessToken) {
    installRuntimeNodeGrpcLocalFirstPartyAuthority(transport, {
      getRuntimeAccountAccessToken,
    });
  }
  return new Runtime({
    appId,
    transport,
  });
}

export async function registerRuntimeApp(
  runtime: Runtime,
  appId: string,
  appInstanceId: string,
  deviceId: string,
  input: {
    readonly appVersion?: string;
    readonly capabilities?: readonly string[];
    readonly developerRegistration?: boolean;
    readonly idempotencyKey?: string;
  } = {},
): Promise<RegisterAppResponse> {
  const response = await runtime.auth.registerApp({
    appId,
    appInstanceId,
    deviceId,
    appVersion: normalizeText(input.appVersion) || 'sdk-runtime-agent-live-e2e',
    capabilities: normalizeStrings(input.capabilities ?? []),
    modeManifest: fullRealmRuntimeModeManifest(),
    developerRegistration: input.developerRegistration === true,
  }, liveIdempotencyOptions(
    normalizeText(input.idempotencyKey)
      || `register-app:${appId}:${appInstanceId}:${input.developerRegistration === true ? 'developer' : 'standard'}`,
  ));
  if (!response.accepted || response.reasonCode !== ReasonCode.ACTION_EXECUTED) {
    throw new Error(`Runtime RegisterApp failed for ${appId}: ${JSON.stringify(response)}`);
  }
  return response;
}

export async function admitDeveloperRegisteredRuntimeAccountCaller(
  runtime: Runtime,
  input: RuntimeAgentLiveE2EDeveloperRegisteredAccountInput,
): Promise<AccountCaller> {
  const appId = requireText(input.appId, 'appId');
  const appInstanceId = requireText(input.appInstanceId, 'appInstanceId');
  const deviceId = requireText(input.deviceId, 'deviceId');
  const capabilities = normalizeStrings([
    ...(input.capabilities ?? []),
    ...(input.scopes ?? []),
  ]);
  const caller = createNimiDeveloperRegisteredRuntimeAccountCaller({
    appId,
    appInstanceId,
    deviceId,
    scopes: input.scopes,
  });
  await registerRuntimeApp(runtime, appId, appInstanceId, deviceId, {
    appVersion: input.appVersion,
    capabilities,
    developerRegistration: true,
    idempotencyKey: `register-developer-account:${appId}:${appInstanceId}`,
  });
  const sessionMetadata = createNimiRuntimeAppSessionMetadataProvider({
    auth: runtime.auth,
    appId,
    appInstanceId,
    deviceId,
    capabilities,
    developerRegistration: true,
  });
  const status = await runtime.account.getAccountSessionStatus({ caller }, { metadata: await sessionMetadata() });
  if (
    status.state !== AccountSessionState.AUTHENTICATED
    || normalizeText(status.accountProjection?.accountId) !== OWNER_USER_ID
  ) {
    throw new Error(`Runtime developer account caller was not admitted to the active account projection: ${JSON.stringify(status)}`);
  }
  return caller;
}

export async function admitLocalFirstPartyRuntimeAccountCaller(
  runtime: Runtime,
  input: RuntimeAgentLiveE2EDeveloperRegisteredAccountInput,
): Promise<AccountCaller> {
  const appId = requireText(input.appId, 'appId');
  const appInstanceId = requireText(input.appInstanceId, 'appInstanceId');
  const deviceId = requireText(input.deviceId, 'deviceId');
  const capabilities = normalizeStrings([
    ...(input.capabilities ?? []),
    ...(input.scopes ?? []),
  ]);
  const caller = createNimiLocalFirstPartyRuntimeAccountCaller({
    appId,
    appInstanceId,
    deviceId,
    scopes: input.scopes,
  });
  await registerRuntimeApp(runtime, appId, appInstanceId, deviceId, {
    appVersion: input.appVersion,
    capabilities,
    developerRegistration: false,
    idempotencyKey: `register-local-first-party-account:${appId}:${appInstanceId}`,
  });
  const sessionMetadata = createNimiRuntimeAppSessionMetadataProvider({
    auth: runtime.auth,
    appId,
    appInstanceId,
    deviceId,
    capabilities,
    developerRegistration: false,
  });
  const status = await runtime.account.getAccountSessionStatus({ caller }, { metadata: await sessionMetadata() });
  if (
    status.state !== AccountSessionState.AUTHENTICATED
    || normalizeText(status.accountProjection?.accountId) !== OWNER_USER_ID
  ) {
    throw new Error(`Runtime local first-party account caller was not admitted to the active account projection: ${JSON.stringify(status)}`);
  }
  return caller;
}

export async function completeRuntimeAccountLogin(runtime: Runtime, caller: AccountCaller): Promise<void> {
  const metadata = await runtimeAccountControlMetadata(runtime, caller);
  const begin = await runtime.account.beginLogin({
    caller,
    redirectUri: RUNTIME_ACCOUNT_REDIRECT_URI,
    callbackOrigin: '',
    ttlSeconds: 300,
  }, liveIdempotencyOptions(`account-begin-login:${caller.appId}:${caller.appInstanceId}`, { metadata }));
  if (!begin.accepted || !begin.loginAttemptId) {
    throw new Error(`Runtime account BeginLogin failed: ${JSON.stringify(begin)}`);
  }
  const complete = await runtime.account.completeLogin({
    caller,
    loginAttemptId: begin.loginAttemptId,
    code: 'runtime-live-auth-code',
    state: begin.state,
    nonce: begin.nonce,
    redirectUri: RUNTIME_ACCOUNT_REDIRECT_URI,
    sealedCompletionTicket: '',
    refreshToken: '',
  }, liveIdempotencyOptions(`account-complete-login:${caller.appId}:${begin.loginAttemptId}`, { metadata }));
  if (!complete.accepted) {
    throw new Error(`Runtime account CompleteLogin failed: ${JSON.stringify(complete)}`);
  }
}

export async function logoutRuntimeAccount(runtime: Runtime, caller: AccountCaller): Promise<void> {
  try {
    const metadata = await runtimeAccountControlMetadata(runtime, caller);
    await runtime.account.logout(
      { caller },
      liveIdempotencyOptions(`account-logout:${caller.appId}:${caller.appInstanceId}`, { metadata }),
    );
  } catch {
    // Best-effort cleanup for the isolated keychain partition.
  }
}

export function createRuntimeMediatedRealmTransport(input: {
  readonly runtime: Runtime;
  readonly caller: AccountCaller;
  readonly realmBaseUrl: string;
}): CoreTransport {
  const sessionMetadata = createNimiRuntimeAppSessionMetadataProvider({
    auth: input.runtime.auth,
    appId: input.caller.appId,
    appInstanceId: input.caller.appInstanceId,
    deviceId: input.caller.deviceId,
    developerRegistration: false,
  });
  return {
    async unary<Response = unknown, Body = unknown>(request: CoreUnaryRequest<Body>): Promise<Response> {
      const response = await input.runtime.account.invokeRealmUnary({
        caller: input.caller,
        methodId: request.methodId,
        realmBaseUrl: input.realmBaseUrl,
        requestJson: JSON.stringify(request.body ?? {}),
        timeoutMs: request.timeoutMs ?? 30_000,
      }, liveIdempotencyOptions(`realm-unary:${request.methodId}`, {
        metadata: {
          ...await sessionMetadata(),
          ...(request.metadata ?? {}),
        },
        timeoutMs: request.timeoutMs,
        signal: request.signal,
        responseMetadataObserver: request.responseMetadataObserver,
      }));
      if (!response.accepted) {
        throw new Error(`Runtime Realm mediation failed for ${request.methodId}: ${JSON.stringify(response)}`);
      }
      return JSON.parse(response.responseJson || '{}') as Response;
    },
    async *serverStream<Response = unknown, Body = unknown>(
      request: CoreStreamRequest<Body>,
    ): AsyncIterable<Response> {
      throw new Error(`Runtime-mediated Realm fixture does not support streams: ${request.methodId}`);
    },
  };
}

export function desktopAccountCaller(): AccountCaller {
  return {
    appId: DESKTOP_APP_ID,
    appInstanceId: DESKTOP_APP_INSTANCE_ID,
    deviceId: DESKTOP_DEVICE_ID,
    mode: AccountCallerMode.DESKTOP_SHELL,
    scopes: [],
    launchHostId: '',
    launchNonce: '',
    releaseDescriptorRef: '',
  };
}

async function runtimeAccountControlMetadata(runtime: Runtime, caller: AccountCaller): Promise<Record<string, string>> {
  const sessionMetadata = createNimiRuntimeAppSessionMetadataProvider({
    auth: runtime.auth,
    appId: caller.appId,
    appInstanceId: caller.appInstanceId,
    deviceId: caller.deviceId,
    developerRegistration: false,
  });
  return {
    ...await sessionMetadata(),
    'x-nimi-source-host': 'desktop-tauri-account-host',
    'x-nimi-app-id': caller.appId,
    'x-nimi-app-instance-id': caller.appInstanceId,
    'x-nimi-device-id': caller.deviceId,
  };
}

export function realmWorldStudioCaller(): AccountCaller {
  return {
    appId: REALM_WORLD_STUDIO_APP_ID,
    appInstanceId: REALM_WORLD_STUDIO_APP_INSTANCE_ID,
    deviceId: REALM_STUDIO_DEVICE_ID,
    mode: AccountCallerMode.LOCAL_FIRST_PARTY_APP,
    scopes: [],
    launchHostId: '',
    launchNonce: '',
    releaseDescriptorRef: '',
  };
}

function runtimeAgentClientRuntime(runtime: Runtime, appId: string):
  NimiRuntimeAgentClientRuntime & NimiRuntimeAgentProtectedRuntime {
  return {
    appId,
    auth: runtime.auth,
    appAuth: runtime.grants,
    agents: runtime.agents,
    appMessages: runtime.appMessages,
  };
}

function runtimeAgentLiveScopeRunner(
  runtime: NimiRuntimeAgentProtectedRuntime,
  sessionMetadata: NimiRuntimeAppSessionMetadataProvider,
  subjectUserId = OWNER_USER_ID,
): NimiRuntimeAgentScopeRunner {
  return (scopes, operation) =>
    withNimiRuntimeAgentScopes({
      runtime,
      subjectUserId,
    }, scopes, async (options) => {
      const appSessionMetadata = await sessionMetadata();
      return operation(liveIdempotencyOptions(`runtime-agent:${scopes.join(',')}`, {
        ...options,
        metadata: {
          ...appSessionMetadata,
          ...(options.metadata ?? {}),
        },
      }));
    });
}

function fullRealmRuntimeModeManifest(): AppModeManifest {
  return {
    appMode: AppMode.FULL,
    runtimeRequired: true,
    realmRequired: true,
    worldRelation: WorldRelation.NONE,
  };
}
