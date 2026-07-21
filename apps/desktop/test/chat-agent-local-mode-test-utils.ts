import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
  fromNimiRuntimeProtoStruct,
  toNimiRuntimeProtoStruct,
  type NimiRuntimeAgentConsumeRequest,
  type NimiRuntimeAgentConsumeEvent,
  type NimiRuntimeAgentMessage,
  type NimiRuntimeAgentSessionSnapshotRequest,
  type NimiRuntimeAgentTurnCancellationReason,
  type NimiRuntimeAgentTurnInterruptRequest,
  type NimiRuntimeAgentTurnRequest,
  type NimiRuntimeAgentTurnsModule,
  type NimiRuntimeAgentScopeRunner,
} from '@nimiplatform/sdk/runtime';
import { createNimiError, ReasonCode, type JsonObject } from '@nimiplatform/sdk/types';
import {
  clearDesktopNimiClientSession,
  setDesktopNimiClientSessionForTests,
  type DesktopNimiClientSession,
} from '../src/shell/renderer/infra/sdk/desktop-nimi-client-session.js';
import {
  CORE_CHAT_AGENT_TARGET_ID,
  streamChatAgentRuntimeAgentTurn as streamChatAgentRuntimeAgentTurnImpl,
  } from '../src/shell/renderer/features/chat/chat-agent-runtime.js';
import {
  resolveAgentChatRequestedMaxOutputTokens,
  } from '../src/shell/renderer/features/chat/chat-nimi-route-view.js';
import { resolveAgentTurnTotalTimeoutMs } from '../src/shell/renderer/features/chat/chat-agent-timeouts.js';
import { hydrateAgentThreadBundleFromRuntimeSessionSnapshot } from '../src/shell/renderer/features/chat/chat-agent-session-hydration.js';
import {
  resolveAgentChatThinkingSupport,
  resolveChatThinkingConfig,
  } from '../src/shell/renderer/features/chat/chat-shared-thinking.js';
import type { AgentLocalThreadSummary } from '../src/shell/renderer/bridge/runtime-bridge/chat-agent-types.js';
import {
  buildAgentEffectiveCapabilityResolution,
  createNimiConversationAISnapshot,
  resolveAgentImageProjectionForExecution,
  } from '../src/shell/renderer/features/chat/conversation-capability.js';
import {
  createNimiBuiltInChatAIScopeRef,
  createEmptyNimiAIConfig as createSdkEmptyAIConfig,
} from '@nimiplatform/sdk/ai';
import { findNimiRuntimeRouteModelProfile } from '@nimiplatform/sdk/runtime';
import type { DesktopRendererSdkPort } from '../src/shell/renderer/renderer/sdk-port.js';
import { createDesktopRuntimeRouteAccess } from '../src/shell/renderer/infra/runtime-route-host-access.js';

const TEST_CHAT_SCOPE_REF = createNimiBuiltInChatAIScopeRef('agent');
let currentDesktopTestSession: DesktopNimiClientSession | null = null;

function createEmptyNimiAIConfig() {
  return createSdkEmptyAIConfig(TEST_CHAT_SCOPE_REF);
}

function readWorkspaceFile(relativePath: string): string {
  return fs.readFileSync(path.join(import.meta.dirname, '..', relativePath), 'utf8');
}

function resetRuntimeLocalModelWarmCacheForTests(): void {
  // Runtime route access is renderer-instance owned; each test gets a fresh instance.
}

function createDefaultDesktopTestRealm() {
  return {
    generated: {},
  };
}

function createDefaultDesktopTestAuth() {
  return {
    registerApp: async () => ({ accepted: true }),
  };
}

function createDefaultDesktopTestAppAuth() {
  return {
    authorizeExternalPrincipal: async () => ({
      tokenId: 'desktop-test-token',
      secret: 'desktop-test-secret',
    }),
  };
}

function createDefaultDesktopTestAccount() {
  return {
    getAccountSessionStatus: async () => ({
      state: 3,
      accountProjection: {
        accountId: 'user-1',
      },
    }),
  };
}

function createDefaultDesktopTestAccountCaller() {
  return {
    appInstanceId: 'desktop-test-instance',
    deviceId: 'desktop-test-device',
  };
}

function normalizeTestText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function decodeRuntimeAgentTurnRequestPayload(value: unknown): NimiRuntimeAgentTurnRequest {
  const payload = fromNimiRuntimeProtoStruct(value as Parameters<typeof fromNimiRuntimeProtoStruct>[0]);
  // Atomic hard cut: the runtime rejects request-level execution_bindings
  // (K-AGCORE-147), so any payload carrying them is a contract violation.
  assert.equal(
    'execution_bindings' in payload,
    false,
    'runtime agent turn payload must not carry execution_bindings',
  );
  const messages = Array.isArray(payload.messages)
    ? payload.messages.map((message) => {
      const record = message && typeof message === 'object' ? message as Record<string, unknown> : {};
      return {
        role: normalizeTestText(record.role) as NimiRuntimeAgentMessage['role'],
        content: normalizeTestText(record.content),
      };
    }).filter((message) => Boolean(message.role && message.content))
    : [];
  assert.equal(messages.length, 1, 'Runtime LocalAgent turn requires exactly one current user message');
  assert.equal(messages[0]?.role, 'user', 'Runtime LocalAgent turn message must be current user');
  return {
    ownerUserId: normalizeTestText(payload.owner_user_id),
    runtimeSourceRef: normalizeTestText(payload.runtime_source_ref),
    localAgentRef: normalizeTestText(payload.local_agent_ref),
    conversationAnchorId: normalizeTestText(payload.conversation_anchor_id),
    requestId: normalizeTestText(payload.request_id) || undefined,
    threadId: normalizeTestText(payload.thread_id) || undefined,
    messages: [{ role: 'user', content: messages[0]!.content }],
  };
}

function runtimeAgentTestEventToAppMessageEvent(input: {
  appId: string;
  event: NimiRuntimeAgentConsumeEvent;
  sequence: number;
  turnRequest: NimiRuntimeAgentTurnRequest | null;
}) {
  const detail = input.event.detail || {};
  const structured = detail.payload || detail.structured;
  const localAgentRef = normalizeTestText(input.event.localAgentRef) || normalizeTestText(input.turnRequest?.localAgentRef);
  const conversationAnchorId = normalizeTestText(input.event.conversationAnchorId) || normalizeTestText(input.turnRequest?.conversationAnchorId);
  const looseEvent = input.event as NimiRuntimeAgentConsumeEvent & {
    readonly messageId?: unknown;
    readonly originatingTurnId?: unknown;
    readonly originatingStreamId?: unknown;
  };
  return {
    eventType: 0,
    sequence: String(input.sequence),
    messageId: normalizeTestText(looseEvent.messageId)
      || normalizeTestText(detail.messageId)
      || `${normalizeTestText(input.event.turnId)}:${input.sequence}`,
    fromAppId: 'runtime.agent',
    toAppId: input.appId,
    subjectUserId: normalizeTestText(input.turnRequest?.ownerUserId),
    messageType: input.event.eventName,
    payload: toNimiRuntimeProtoStruct({
      local_agent_ref: localAgentRef,
      conversation_anchor_id: conversationAnchorId,
      turn_id: normalizeTestText(input.event.turnId),
      stream_id: normalizeTestText(input.event.streamId),
      ...(normalizeTestText(detail.requestId) ? { request_id: normalizeTestText(detail.requestId) } : {}),
      ...(normalizeTestText(detail.text) ? { text: normalizeTestText(detail.text) } : {}),
      ...(normalizeTestText(detail.messageId) ? { message_id: normalizeTestText(detail.messageId) } : {}),
      ...(normalizeTestText(detail.terminalReason) ? { terminal_reason: normalizeTestText(detail.terminalReason) } : {}),
      ...(normalizeTestText(detail.reasonCode) ? { reason_code: normalizeTestText(detail.reasonCode) } : {}),
      ...(normalizeTestText(detail.message) ? { message: normalizeTestText(detail.message) } : {}),
      ...(input.event.timeline ? { runtime_timeline: input.event.timeline } : {}),
      ...(normalizeTestText(looseEvent.originatingTurnId) ? { originating_turn_id: normalizeTestText(looseEvent.originatingTurnId) } : {}),
      ...(normalizeTestText(looseEvent.originatingStreamId) ? { originating_stream_id: normalizeTestText(looseEvent.originatingStreamId) } : {}),
      ...(normalizeTestText(detail.currentStatusText) ? { current_status_text: normalizeTestText(detail.currentStatusText) } : {}),
      ...(normalizeTestText(detail.previousStatusText) ? { previous_status_text: normalizeTestText(detail.previousStatusText) } : {}),
      ...(normalizeTestText(detail.intentId) ? { intent_id: normalizeTestText(detail.intentId) } : {}),
      ...(normalizeTestText(detail.triggerFamily) ? { trigger_family: normalizeTestText(detail.triggerFamily) } : {}),
      ...(detail.triggerDetail && typeof detail.triggerDetail === 'object' ? { trigger_detail: detail.triggerDetail } : {}),
      ...(normalizeTestText(detail.effect) ? { effect: normalizeTestText(detail.effect) } : {}),
      ...(normalizeTestText(detail.admissionState) ? { admission_state: normalizeTestText(detail.admissionState) } : {}),
      ...(normalizeTestText(detail.activityName) ? { activity_name: normalizeTestText(detail.activityName) } : {}),
      ...(normalizeTestText(detail.category) ? { category: normalizeTestText(detail.category) } : {}),
      ...(normalizeTestText(detail.intensity) ? { intensity: normalizeTestText(detail.intensity) } : {}),
      ...(normalizeTestText(detail.source) ? { source: normalizeTestText(detail.source) } : {}),
      ...(structured && typeof structured === 'object' ? { structured } : {}),
    } as unknown as JsonObject),
    reasonCode: 0,
    traceId: '',
  };
}

function createDesktopTestRuntimeFromAgentTurns(input: {
  appId: string;
  turns: NimiRuntimeAgentTurnsModule;
}) {
  let lastTurnRequest: NimiRuntimeAgentTurnRequest | null = null;
  let activeSubscribeRequest: (NimiRuntimeAgentConsumeRequest & { includeAgentEvents: boolean }) | null = null;
  return {
    appId: input.appId,
    auth: createDefaultDesktopTestAuth(),
    account: createDefaultDesktopTestAccount(),
    appAuth: createDefaultDesktopTestAppAuth(),
    grants: createDefaultDesktopTestAppAuth(),
    agents: {
      subscribeAgentEvents: async () => (async function* emptyAgentEvents() {})(),
      getPublicChatSessionSnapshot: async (request: NimiRuntimeAgentSessionSnapshotRequest) => ({
        snapshot: toNimiRuntimeProtoStruct(
          await input.turns.getSessionSnapshot(request) as unknown as JsonObject,
        ),
      }),
    },
    appMessages: {
      subscribeAppMessages: async () => {
        activeSubscribeRequest = {
          ownerUserId: '',
          runtimeSourceRef: '',
          localAgentRef: '',
          conversationAnchorId: '',
          includeAgentEvents: false,
        };
        const stream = await input.turns.subscribe(activeSubscribeRequest);
        return (async function* appMessages() {
          let sequence = 0;
          for await (const event of stream) {
            sequence += 1;
            yield runtimeAgentTestEventToAppMessageEvent({
              appId: input.appId,
              event,
              sequence,
              turnRequest: lastTurnRequest,
            });
          }
        })();
      },
      sendAppMessage: async (request: { messageType?: string; payload?: unknown }) => {
        const payloadRequest = request.messageType === 'runtime.agent.turn.interrupt'
          ? null
          : decodeRuntimeAgentTurnRequestPayload(request.payload);
        if (payloadRequest) {
          lastTurnRequest = payloadRequest;
          if (activeSubscribeRequest) {
            Object.assign(activeSubscribeRequest, {
              ownerUserId: payloadRequest.ownerUserId,
              runtimeSourceRef: payloadRequest.runtimeSourceRef,
              localAgentRef: payloadRequest.localAgentRef,
              conversationAnchorId: payloadRequest.conversationAnchorId,
              threadId: payloadRequest.threadId,
            });
          }
          const response = await input.turns.request(payloadRequest);
          return {
            accepted: true,
            messageId: response?.messageId || payloadRequest.requestId || '',
            reasonCode: 0,
          };
        }
        const interruptPayload = fromNimiRuntimeProtoStruct(request.payload as Parameters<typeof fromNimiRuntimeProtoStruct>[0]);
        const interrupt: NimiRuntimeAgentTurnInterruptRequest = {
          ownerUserId: normalizeTestText(lastTurnRequest?.ownerUserId),
          runtimeSourceRef: normalizeTestText(lastTurnRequest?.runtimeSourceRef),
          localAgentRef: normalizeTestText(lastTurnRequest?.localAgentRef),
          conversationAnchorId: normalizeTestText(interruptPayload.conversation_anchor_id),
          reason: normalizeTestTurnCancellationReason(interruptPayload.reason),
          ...(normalizeTestText(interruptPayload.turn_id) ? { turnId: normalizeTestText(interruptPayload.turn_id) } : {}),
        };
        const response = await input.turns.interrupt(interrupt);
        return {
          accepted: true,
          messageId: response?.messageId || '',
          reasonCode: 0,
        };
      },
    },
  };
}

function normalizeTestTurnCancellationReason(value: unknown): NimiRuntimeAgentTurnCancellationReason | undefined {
  const reason = normalizeTestText(value);
  if (!reason) return undefined;
  if ([
    'user_cancel',
    'room_closed',
    'superseded_turn',
    'budget_exhausted',
    'timeout',
    'gateway_revoked',
    'policy_refusal',
  ].includes(reason)) return reason as NimiRuntimeAgentTurnCancellationReason;
  throw new Error(`test Runtime turn interrupt received unadmitted cancellation reason ${reason}`);
}

function normalizeDesktopTestRuntime(appId: string, runtime: unknown) {
  const candidate = runtime && typeof runtime === 'object'
    ? runtime as { agent?: { turns?: NimiRuntimeAgentTurnsModule } }
    : {};
  if (candidate.agent?.turns) {
    return createDesktopTestRuntimeFromAgentTurns({ appId, turns: candidate.agent.turns });
  }
  return runtime;
}

function normalizeDesktopTestRuntimeTransport(value: unknown) {
  const candidate = value && typeof value === 'object'
    ? value as { readonly type?: unknown }
    : null;
  if (candidate?.type === 'electron-ipc' || candidate?.type === 'tauri-ipc') {
    return candidate;
  }
  // Runtime Agent unit doubles exercise the final Electron host-owned carrier.
  // Tauri's renderer-side fail-closed posture has dedicated contract coverage.
  return { type: 'electron-ipc' as const };
}

function clearDesktopTestNimiClientSession() {
  currentDesktopTestSession = null;
  clearDesktopNimiClientSession();
}

function createDesktopTestNimiClientSession(input: {
  appId: string;
  realmBaseUrl?: string;
  allowAnonymousRealm?: boolean;
  runtimeTransport?: unknown;
  turns?: NimiRuntimeAgentTurnsModule;
  runtime?: unknown;
}) {
  let currentRuntime: unknown = input.runtime || (input.turns
    ? createDesktopTestRuntimeFromAgentTurns({ appId: input.appId, turns: input.turns })
    : {
      appId: input.appId,
      auth: createDefaultDesktopTestAuth(),
      account: createDefaultDesktopTestAccount(),
      appAuth: createDefaultDesktopTestAppAuth(),
      grants: createDefaultDesktopTestAppAuth(),
    });
  const session = {
    appId: input.appId,
    runtimeTransport: normalizeDesktopTestRuntimeTransport(input.runtimeTransport),
    client: {},
    accountCaller: createDefaultDesktopTestAccountCaller(),
    get runtime() {
      return currentRuntime;
    },
    set runtime(nextRuntime: unknown) {
      currentRuntime = normalizeDesktopTestRuntime(input.appId, nextRuntime);
    },
    get accountRuntime() {
      return currentRuntime;
    },
    realm: createDefaultDesktopTestRealm(),
  } as unknown as DesktopNimiClientSession;
  currentDesktopTestSession = session;
  setDesktopNimiClientSessionForTests(session);
  return session;
}

function getDesktopTestRendererSdk(): DesktopRendererSdkPort {
  const session = currentDesktopTestSession;
  if (!session?.runtime || !session.accountRuntime) {
    throw new Error('DESKTOP_TEST_RUNTIME_SESSION_MISSING');
  }
  const runtime = session.runtime;
  const accountRuntime = session.accountRuntime;
  const runtimeRouteAccess = createDesktopRuntimeRouteAccess(() => runtime);
  return {
    appId: () => session.appId,
    runtime: () => runtime,
    runtimeAgentTurns: () => ({
      appId: session.appId,
      auth: accountRuntime.auth,
      agents: runtime.agents,
      appMessages: runtime.appMessages,
    }),
    runtimeRouteAccess: () => runtimeRouteAccess,
    withRuntimeProtectedScopes: (async (_scopes, operation) => operation({})) as NimiRuntimeAgentScopeRunner,
  } as unknown as DesktopRendererSdkPort;
}

function streamChatAgentRuntimeAgentTurn(
  request: Parameters<typeof streamChatAgentRuntimeAgentTurnImpl>[0],
) {
  return streamChatAgentRuntimeAgentTurnImpl(request, getDesktopTestRendererSdk());
}

function createRuntimeTurnTimeline(input: {
  turnId: string;
  streamId: string;
  channel: 'text' | 'state';
  sequence: number;
  offsetMs?: number;
}) {
  return {
    turnId: input.turnId,
    streamId: input.streamId,
    channel: input.channel,
    offsetMs: input.offsetMs ?? 10,
    sequence: input.sequence,
    startedAtWall: '2026-04-25T00:00:00.000Z',
    observedAtWall: '2026-04-25T00:00:00.010Z',
    timebaseOwner: 'runtime' as const,
    projectionRuleId: 'K-AGCORE-051' as const,
    clockBasis: 'monotonic_with_wall_anchor' as const,
    providerNeutral: true as const,
    appLocalAuthority: false as const,
  };
}

function createLocalTextProjection() {
  return {
    capability: 'text.generate' as const,
    selectedTargetRef: { kind: 'local-runtime' as const, version: 'v2' as const, profileBindingId: 'local-runtime:llama3' },
    resolvedBinding: {
      capability: 'text.generate' as const,
      resolvedBindingRef: 'test:resolved',
      source: 'local-runtime' as const,
      targetRef: { kind: 'local-runtime' as const, version: 'v2' as const, profileBindingId: 'local-runtime:test-local' },
      provider: 'llama',
      model: 'llama3',
      modelId: 'llama3',
      localModelId: 'local-model-1',
      connectorId: '',
      endpoint: 'http://127.0.0.1:11434/v1',
      localProviderEndpoint: 'http://127.0.0.1:11434/v1',
    },
    health: {
      healthy: true,
      status: 'healthy' as const,
      provider: 'llama',
      detail: 'ready',
      actionHint: 'use_local_runtime_route',
    },
    metadata: {
      capability: 'text.generate' as const,
      metadataVersion: 'v1' as const,
      resolvedBindingRef: 'local:llama3',
      metadataKind: 'text.generate' as const,
      metadata: {
        supportsThinking: false,
        traceModeSupport: 'none' as const,
        supportsImageInput: false,
        supportsAudioInput: false,
        supportsVideoInput: false,
        supportsArtifactRefInput: false,
      },
    },
    supported: true,
    reasonCode: null,
  };
}

function createCloudTextProjection() {
  return {
    capability: 'text.generate' as const,
    selectedTargetRef: { kind: 'cloud-connector' as const, version: 'v2' as const, connectorId: 'connector-openai', remoteModelCatalogId: 'remote-catalog:connector-openai:gpt-5.4-mini', providerModelId: 'gpt-5.4-mini' },
    resolvedBinding: {
      capability: 'text.generate' as const,
      resolvedBindingRef: 'test:resolved',
      source: 'cloud-connector' as const,
      targetRef: { kind: 'cloud-connector' as const, version: 'v2' as const, connectorId: 'connector-test', remoteModelCatalogId: 'remote-catalog:connector-test:test-model', providerModelId: 'test-model' },
      provider: 'openai',
      model: 'gpt-5.4-mini',
      modelId: 'gpt-5.4-mini',
      connectorId: 'connector-openai',
    },
    health: {
      healthy: true,
      status: 'healthy' as const,
      provider: 'openai',
      detail: 'ready',
      actionHint: 'use_cloud_runtime_route',
    },
    metadata: {
      capability: 'text.generate' as const,
      metadataVersion: 'v1' as const,
      resolvedBindingRef: 'cloud:connector-openai:gpt-5.4-mini',
      metadataKind: 'text.generate' as const,
      metadata: {
        supportsThinking: true,
        traceModeSupport: 'separate' as const,
        supportsImageInput: true,
        supportsAudioInput: false,
        supportsVideoInput: false,
        supportsArtifactRefInput: false,
      },
    },
    supported: true,
    reasonCode: null,
  };
}

export {
  assert,
  path,
  test,
  clearDesktopTestNimiClientSession,
  createDesktopTestNimiClientSession,
  createNimiError,
  toNimiRuntimeProtoStruct,
  ReasonCode,
  resetRuntimeLocalModelWarmCacheForTests,
  CORE_CHAT_AGENT_TARGET_ID,
  streamChatAgentRuntimeAgentTurn,
  getDesktopTestRendererSdk,
  findNimiRuntimeRouteModelProfile,
  resolveAgentChatRequestedMaxOutputTokens,
  resolveAgentTurnTotalTimeoutMs,
  hydrateAgentThreadBundleFromRuntimeSessionSnapshot,
  resolveAgentChatThinkingSupport,
  resolveChatThinkingConfig,
  buildAgentEffectiveCapabilityResolution,
  createNimiConversationAISnapshot,
  resolveAgentImageProjectionForExecution,
  createEmptyNimiAIConfig,
  readWorkspaceFile,
  createRuntimeTurnTimeline,
  createLocalTextProjection,
  createCloudTextProjection,
};

export type {
  AgentLocalThreadSummary,
};
