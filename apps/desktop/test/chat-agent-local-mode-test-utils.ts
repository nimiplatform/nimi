import assert from 'node:assert/strict';
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
  type NimiDesktopAccountProductRuntimeClient,
  type NimiDesktopMachineProductRuntimeClient,
} from '@nimiplatform/sdk/runtime';
import { createNimiError, ReasonCode, type JsonObject } from '@nimiplatform/sdk/types';
import {
  clearDesktopNimiClientSession,
  createDesktopRuntimeAgentDiscoverySurface,
  setDesktopNimiClientSessionForTests,
  type DesktopAccountRuntime,
  type DesktopNimiClientSession,
} from '../src/shell/renderer/infra/sdk/desktop-nimi-client-session.js';
import {
  streamChatAgentRuntimeAgentTurn as streamChatAgentRuntimeAgentTurnImpl,
} from '../src/shell/renderer/features/chat/chat-agent-runtime.js';
import {
  hydrateAgentThreadBundleFromRuntimeSessionSnapshot,
  shouldRefreshAgentRuntimeSessionSnapshotForEvent,
} from '../src/shell/renderer/features/chat/chat-agent-session-hydration.js';
import type { DesktopRendererSdkPort } from '../src/shell/renderer/renderer/sdk-port.js';
type DesktopTestRuntime =
  & NimiDesktopMachineProductRuntimeClient
  & NimiDesktopAccountProductRuntimeClient
  & DesktopAccountRuntime;
type DesktopTestNimiClientSession = DesktopNimiClientSession & {
  readonly runtime: DesktopTestRuntime;
  readonly accountRuntime: DesktopTestRuntime;
};

let currentDesktopTestSession: DesktopTestNimiClientSession | null = null;

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
  if (candidate?.type === 'electron-ipc') {
    return candidate;
  }
  // Runtime Agent unit doubles exercise the Electron host-owned carrier.
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
  let currentRuntime = (input.runtime || (input.turns
    ? createDesktopTestRuntimeFromAgentTurns({ appId: input.appId, turns: input.turns })
    : {
      appId: input.appId,
      auth: createDefaultDesktopTestAuth(),
      account: createDefaultDesktopTestAccount(),
      appAuth: createDefaultDesktopTestAppAuth(),
      grants: createDefaultDesktopTestAppAuth(),
    })) as DesktopTestRuntime;
  const session = {
    appId: input.appId,
    runtimeTransport: normalizeDesktopTestRuntimeTransport(input.runtimeTransport),
    accountCaller: createDefaultDesktopTestAccountCaller(),
    get runtime() {
      return currentRuntime;
    },
    set runtime(nextRuntime: unknown) {
      currentRuntime = normalizeDesktopTestRuntime(input.appId, nextRuntime) as DesktopTestRuntime;
    },
    get runtimeClients() {
      const runtime = currentRuntime as Record<string, unknown>;
      return {
        machineProduct: {
          local: runtime.local,
          connectors: runtime.connectors,
          audit: runtime.audit,
          ai: runtime.ai,
          scheduling: runtime.scheduling,
          externalAgents: runtime.externalAgents,
        },
        accountProduct: {
          agents: runtime.agents,
          connectors: runtime.connectors,
          appMessages: runtime.appMessages,
          artifacts: runtime.artifacts,
          materializeRealmSource: runtime.materializeRealmSource,
        },
        agentPurpose: runtime.agents,
        auth: runtime.auth,
        aiScenarioJobs: runtime.ai,
      };
    },
    get accountRuntime() {
      return currentRuntime;
    },
    realm: createDefaultDesktopTestRealm(),
  } as unknown as DesktopNimiClientSession;
  currentDesktopTestSession = session as unknown as DesktopTestNimiClientSession;
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
  return {
    appId: () => session.appId,
    machineProduct: () => runtime,
    accountProduct: () => runtime,
    connectorAdmin: () => runtime.connectors,
    localAssetAdmin: () => runtime.local,
    localAudit: () => runtime.local,
    auditAdmin: () => runtime.audit,
    aiExecution: () => ({ ai: runtime.ai }),
    externalAgent: () => runtime.externalAgents,
    runtimeAgentOwner: () => runtime.agents,
    runtimeAgentDiscovery: createDesktopRuntimeAgentDiscoverySurface,
    runtimeAgentTurns: () => ({
      appId: session.appId,
      auth: accountRuntime.auth,
      agents: runtime.agents,
      appMessages: runtime.appMessages,
    }),
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

export {
  assert,
  test,
  clearDesktopTestNimiClientSession,
  createDesktopTestNimiClientSession,
  createNimiError,
  toNimiRuntimeProtoStruct,
  ReasonCode,
  streamChatAgentRuntimeAgentTurn,
  getDesktopTestRendererSdk,
  hydrateAgentThreadBundleFromRuntimeSessionSnapshot,
  shouldRefreshAgentRuntimeSessionSnapshotForEvent,
  createRuntimeTurnTimeline,
};
