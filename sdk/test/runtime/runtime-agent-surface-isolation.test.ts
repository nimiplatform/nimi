import assert from 'node:assert/strict';
import test from 'node:test';

import { Struct } from '../../src/runtime/generated/google/protobuf/struct.js';
import { Timestamp } from '../../src/runtime/generated/google/protobuf/timestamp.js';
import {
  AppMessageEvent,
  AppMessageEventType,
} from '../../src/runtime/generated/runtime/v1/app.js';
import { RegisterAppResponse } from '../../src/runtime/generated/runtime/v1/auth.js';
import {
  AgentEvent,
  AgentEventType,
  AgentExecutionState,
  AgentStateEventFamily,
  SubscribeAgentEventsRequest,
} from '../../src/runtime/generated/runtime/v1/agent_service.js';
import { AuthorizeExternalPrincipalResponse } from '../../src/runtime/generated/runtime/v1/grant.js';
import { ReasonCode as RuntimeProtoReasonCode } from '../../src/runtime/generated/runtime/v1/common.js';
import { Runtime } from '../../src/runtime/runtime.js';
import { RuntimeMethodIds } from '../../src/runtime/method-ids.js';
import { setNodeGrpcBridge, type NodeGrpcBridge } from '../../src/runtime/transports/node-grpc.js';
import type { RuntimeAgentConsumeEvent } from '../../src/runtime/types-runtime-modules.js';

const APP_ID = 'nimi.runtime.agent.surface.test';
const TIMELINE_STARTED_AT = '2026-04-25T00:00:00.000Z';

function timelineChannelForTestEvent(messageType: string): 'text' | 'state' | '' {
  switch (messageType) {
    case 'runtime.agent.turn.text_delta':
    case 'runtime.agent.turn.reasoning_delta':
    case 'runtime.agent.turn.structured':
    case 'runtime.agent.turn.message_committed':
      return 'text';
    case 'runtime.agent.turn.accepted':
    case 'runtime.agent.turn.started':
    case 'runtime.agent.turn.post_turn':
    case 'runtime.agent.turn.completed':
    case 'runtime.agent.turn.failed':
    case 'runtime.agent.turn.interrupted':
    case 'runtime.agent.turn.interrupt_ack':
      return 'state';
    default:
      return '';
  }
}

function withRuntimeTimeline(messageType: string, payload: Record<string, unknown>): Record<string, unknown> {
  const channel = timelineChannelForTestEvent(messageType);
  if (!channel || payload.timeline) {
    return payload;
  }
  return {
    ...payload,
    timeline: {
      turn_id: payload.turn_id,
      stream_id: payload.stream_id,
      channel,
      offset_ms: 12,
      sequence: 1,
      started_at_wall: TIMELINE_STARTED_AT,
      observed_at_wall: '2026-04-25T00:00:00.012Z',
      timebase_owner: 'runtime',
      projection_rule_id: 'K-AGCORE-051',
      clock_basis: 'monotonic_with_wall_anchor',
      provider_neutral: true,
      app_local_authority: false,
    },
  };
}

function installNodeGrpcBridge(bridge: NodeGrpcBridge): void {
  setNodeGrpcBridge(bridge);
}

function clearNodeGrpcBridge(): void {
  setNodeGrpcBridge(null);
}

function createAppEvent(messageType: string, payload: Record<string, unknown>): Uint8Array {
  return AppMessageEvent.toBinary(AppMessageEvent.create({
    eventType: AppMessageEventType.APP_MESSAGE_EVENT_RECEIVED,
    sequence: '1',
    messageId: `msg-${messageType}`,
    fromAppId: 'runtime.agent',
    toAppId: APP_ID,
    subjectUserId: 'subject-1',
    messageType,
    payload: Struct.fromJson(withRuntimeTimeline(messageType, payload) as never),
    reasonCode: RuntimeProtoReasonCode.ACTION_EXECUTED,
    traceId: `trace-${messageType}`,
    timestamp: Timestamp.create({ seconds: '1700000002', nanos: 0 }),
  }));
}

function createAgentEvent(input: Parameters<typeof AgentEvent.create>[0]): Uint8Array {
  return AgentEvent.toBinary(AgentEvent.create({
    sequence: '1',
    timestamp: Timestamp.create({ seconds: '1700000003', nanos: 0 }),
    ...input,
  }));
}

async function collectRuntimeAgentEvents(
  stream: AsyncIterable<RuntimeAgentConsumeEvent>,
): Promise<RuntimeAgentConsumeEvent[]> {
  const events: RuntimeAgentConsumeEvent[] = [];
  for await (const event of stream) {
    events.push(event);
  }
  return events;
}

test('runtime agent consume surface keeps multi-agent and same-agent different-anchor subscriptions isolated', async () => {
  const capturedSubscribeRequests: SubscribeAgentEventsRequest[] = [];

  installNodeGrpcBridge({
    invokeUnary: async (_config, input) => {
      if (input.methodId === RuntimeMethodIds.auth.registerApp) {
        return RegisterAppResponse.toBinary(RegisterAppResponse.create({
          accepted: true,
        }));
      }
      if (input.methodId === RuntimeMethodIds.appAuth.authorizeExternalPrincipal) {
        return AuthorizeExternalPrincipalResponse.toBinary(AuthorizeExternalPrincipalResponse.create({
          tokenId: 'token-1',
          appId: APP_ID,
          subjectUserId: 'subject-1',
          externalPrincipalId: APP_ID,
          effectiveScopes: ['runtime.agent.turn.read'],
          policyVersion: '1.0.0',
          issuedScopeCatalogVersion: '1.0.0',
          canDelegate: false,
          secret: 'secret-1',
        }));
      }
      throw new Error(`unexpected method: ${input.methodId}`);
    },
    openStream: async (_config, input) => {
      if (input.methodId === RuntimeMethodIds.app.subscribeAppMessages) {
        return {
          async *[Symbol.asyncIterator]() {
            yield createAppEvent('runtime.agent.turn.accepted', {
              agent_id: 'agent-1',
              conversation_anchor_id: 'anchor-1',
              turn_id: 'turn-a1',
              stream_id: 'stream-a1',
              detail: { request_id: 'req-a1' },
            });
            yield createAppEvent('runtime.agent.turn.text_delta', {
              agent_id: 'agent-1',
              conversation_anchor_id: 'anchor-1',
              turn_id: 'turn-a1',
              stream_id: 'stream-a1',
              detail: { text: 'alpha one' },
            });
            yield createAppEvent('runtime.agent.turn.accepted', {
              agent_id: 'agent-1',
              conversation_anchor_id: 'anchor-2',
              turn_id: 'turn-a2',
              stream_id: 'stream-a2',
              detail: { request_id: 'req-a2' },
            });
            yield createAppEvent('runtime.agent.turn.text_delta', {
              agent_id: 'agent-1',
              conversation_anchor_id: 'anchor-2',
              turn_id: 'turn-a2',
              stream_id: 'stream-a2',
              detail: { text: 'alpha two' },
            });
            yield createAppEvent('runtime.agent.turn.accepted', {
              agent_id: 'agent-2',
              conversation_anchor_id: 'anchor-b1',
              turn_id: 'turn-b1',
              stream_id: 'stream-b1',
              detail: { request_id: 'req-b1' },
            });
            yield createAppEvent('runtime.agent.turn.text_delta', {
              agent_id: 'agent-2',
              conversation_anchor_id: 'anchor-b1',
              turn_id: 'turn-b1',
              stream_id: 'stream-b1',
              detail: { text: 'beta one' },
            });
          },
        };
      }
      if (input.methodId === RuntimeMethodIds.agent.subscribeEvents) {
        const request = SubscribeAgentEventsRequest.fromBinary(input.request);
        capturedSubscribeRequests.push(request);
        if (request.agentId === 'agent-1') {
          return {
            async *[Symbol.asyncIterator]() {
              yield createAgentEvent({
                eventType: AgentEventType.STATE,
                agentId: 'agent-1',
                detail: {
                  oneofKind: 'state',
                  state: {
                    family: AgentStateEventFamily.EXECUTION_STATE_CHANGED,
                    conversationAnchorId: 'anchor-1',
                    originatingTurnId: 'turn-a1',
                    originatingStreamId: 'stream-a1',
                    currentExecutionState: AgentExecutionState.CHAT_ACTIVE,
                    previousExecutionState: AgentExecutionState.IDLE,
                  },
                },
              });
              yield createAgentEvent({
                eventType: AgentEventType.STATE,
                agentId: 'agent-1',
                detail: {
                  oneofKind: 'state',
                  state: {
                    family: AgentStateEventFamily.EXECUTION_STATE_CHANGED,
                    conversationAnchorId: 'anchor-2',
                    originatingTurnId: 'turn-a2',
                    originatingStreamId: 'stream-a2',
                    currentExecutionState: AgentExecutionState.LIFE_PENDING,
                    previousExecutionState: AgentExecutionState.IDLE,
                  },
                },
              });
            },
          };
        }
        if (request.agentId === 'agent-2') {
          return {
            async *[Symbol.asyncIterator]() {
              yield createAgentEvent({
                eventType: AgentEventType.STATE,
                agentId: 'agent-2',
                detail: {
                  oneofKind: 'state',
                  state: {
                    family: AgentStateEventFamily.EXECUTION_STATE_CHANGED,
                    conversationAnchorId: 'anchor-b1',
                    originatingTurnId: 'turn-b1',
                    originatingStreamId: 'stream-b1',
                    currentExecutionState: AgentExecutionState.CHAT_ACTIVE,
                    previousExecutionState: AgentExecutionState.IDLE,
                  },
                },
              });
            },
          };
        }
      }
      throw new Error(`unexpected stream method: ${input.methodId}`);
    },
    closeStream: async () => {},
  });

  try {
    const runtimeAlphaAnchorOne = new Runtime({
      appId: APP_ID,
      transport: {
        type: 'node-grpc',
        endpoint: '127.0.0.1:46371',
      },
      subjectContext: {
        subjectUserId: 'subject-1',
      },
    });
    const runtimeAlphaAnchorTwo = new Runtime({
      appId: APP_ID,
      transport: {
        type: 'node-grpc',
        endpoint: '127.0.0.1:46371',
      },
      subjectContext: {
        subjectUserId: 'subject-1',
      },
    });
    const runtimeBetaAnchorOne = new Runtime({
      appId: APP_ID,
      transport: {
        type: 'node-grpc',
        endpoint: '127.0.0.1:46371',
      },
      subjectContext: {
        subjectUserId: 'subject-1',
      },
    });

    const alphaAnchorOneEvents = await collectRuntimeAgentEvents(
      await runtimeAlphaAnchorOne.agent.turns.subscribe({
        agentId: 'agent-1',
        conversationAnchorId: 'anchor-1',
      }),
    );
    const alphaAnchorTwoEvents = await collectRuntimeAgentEvents(
      await runtimeAlphaAnchorTwo.agent.turns.subscribe({
        agentId: 'agent-1',
        conversationAnchorId: 'anchor-2',
      }),
    );
    const betaAnchorOneEvents = await collectRuntimeAgentEvents(
      await runtimeBetaAnchorOne.agent.turns.subscribe({
        agentId: 'agent-2',
        conversationAnchorId: 'anchor-b1',
      }),
    );

    assert.deepEqual(
      new Set(alphaAnchorOneEvents.map((event) => `${event.agentId}:${event.conversationAnchorId}`)),
      new Set(['agent-1:anchor-1']),
    );
    assert.deepEqual(
      new Set(alphaAnchorTwoEvents.map((event) => `${event.agentId}:${event.conversationAnchorId}`)),
      new Set(['agent-1:anchor-2']),
    );
    assert.deepEqual(
      new Set(betaAnchorOneEvents.map((event) => `${event.agentId}:${event.conversationAnchorId}`)),
      new Set(['agent-2:anchor-b1']),
    );

    assert.ok(alphaAnchorOneEvents.some((event) => event.eventName === 'runtime.agent.turn.accepted'));
    assert.ok(alphaAnchorOneEvents.some((event) => event.eventName === 'runtime.agent.state.execution_state_changed'));
    assert.ok(alphaAnchorTwoEvents.some((event) => event.eventName === 'runtime.agent.turn.text_delta'));
    assert.ok(betaAnchorOneEvents.some((event) => event.eventName === 'runtime.agent.turn.text_delta'));

    assert.deepEqual(
      capturedSubscribeRequests.map((request) => request.agentId),
      ['agent-1', 'agent-1', 'agent-2'],
    );
  } finally {
    clearNodeGrpcBridge();
  }
});
