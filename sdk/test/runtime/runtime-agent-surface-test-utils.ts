import assert from 'node:assert/strict';
import test from 'node:test';

import { Struct } from '../../src/runtime/generated/google/protobuf/struct.js';
import { Timestamp } from '../../src/runtime/generated/google/protobuf/timestamp.js';
import {
  AppMessageEvent,
  AppMessageEventType,
  SendAppMessageRequest,
  SendAppMessageResponse,
  SubscribeAppMessagesRequest,
} from '../../src/runtime/generated/runtime/v1/app.js';
import { RegisterAppRequest, RegisterAppResponse } from '../../src/runtime/generated/runtime/v1/auth.js';
import {
  AgentEvent,
  AgentEventType,
  AgentExecutionState,
  AgentStateEventFamily,
  ConversationAnchor,
  ConversationAnchorStatus,
  GetConversationAnchorSnapshotRequest,
  GetConversationAnchorSnapshotResponse,
  GetPublicChatSessionSnapshotRequest,
  GetPublicChatSessionSnapshotResponse,
  HookAdmissionState,
  HookEffect,
  HookTriggerFamily,
  OpenConversationAnchorRequest,
  OpenConversationAnchorResponse,
  RegisterAvatarLiveInstanceBindingRequest,
  RegisterAvatarLiveInstanceBindingResponse,
  ResolveAvatarLiveInstanceBindingRequest,
  ResolveAvatarLiveInstanceBindingResponse,
  SubscribeAgentEventsRequest,
} from '../../src/runtime/generated/runtime/v1/agent_service.js';
import {
  AuthorizeExternalPrincipalRequest,
  AuthorizeExternalPrincipalResponse,
} from '../../src/runtime/generated/runtime/v1/grant.js';
import { ReasonCode as RuntimeProtoReasonCode } from '../../src/runtime/generated/runtime/v1/common.js';
import { Runtime } from '../../src/runtime/runtime.js';
import { parseAgentConsumeEvent, parseAppConsumeEvent } from '../../src/runtime/runtime-agent-surface-parsers.js';
import { RuntimeMethodIds } from '../../src/runtime/method-ids.js';
import { setNodeGrpcBridge, type NodeGrpcBridge } from '../../src/runtime/transports/node-grpc.js';
import type { RuntimeAgentConsumeEvent } from '../../src/runtime/types-runtime-agent.js';

const APP_ID = 'nimi.runtime.agent.surface.test';
const OWNER_USER_ID = 'subject-1';
const REALM_AGENT_ID = 'agent-1';
const LOCAL_AGENT_REF = `local-agent:${OWNER_USER_ID}:${REALM_AGENT_ID}`;
const LOCAL_AGENT_IDENTITY = {
  ownerUserId: OWNER_USER_ID,
  realmAgentId: REALM_AGENT_ID,
  localAgentRef: LOCAL_AGENT_REF,
} as const;
const OPEN_CONVERSATION_ANCHOR_METHOD = '/nimi.runtime.v1.RuntimeAgentService/OpenConversationAnchor';
const GET_CONVERSATION_ANCHOR_SNAPSHOT_METHOD = '/nimi.runtime.v1.RuntimeAgentService/GetConversationAnchorSnapshot';
const REGISTER_AVATAR_LIVE_INSTANCE_BINDING_METHOD = '/nimi.runtime.v1.RuntimeAgentService/RegisterAvatarLiveInstanceBinding';
const RESOLVE_AVATAR_LIVE_INSTANCE_BINDING_METHOD = '/nimi.runtime.v1.RuntimeAgentService/ResolveAvatarLiveInstanceBinding';
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

function createAnchorSnapshot(anchorId: string, agentId: string) {
  return {
    anchor: ConversationAnchor.create({
      conversationAnchorId: anchorId,
      agentId,
      subjectUserId: 'subject-1',
      status: ConversationAnchorStatus.ACTIVE,
      lastTurnId: 'turn-last',
      lastMessageId: 'msg-last',
      updatedAt: Timestamp.create({ seconds: '1700000001', nanos: 0 }),
    }),
    activeTurnId: 'turn-active',
    activeStreamId: 'stream-active',
  };
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
  const inputAgentId = typeof input?.agentId === 'string' ? input.agentId : '';
  const realmAgentId = input?.realmAgentId || (inputAgentId.startsWith('local-agent:') ? REALM_AGENT_ID : inputAgentId) || REALM_AGENT_ID;
  const ownerUserId = input?.ownerUserId || OWNER_USER_ID;
  const localAgentRef = input?.localAgentRef || (inputAgentId.startsWith('local-agent:')
    ? inputAgentId
    : `local-agent:${ownerUserId}:${realmAgentId}`);
  return AgentEvent.toBinary(AgentEvent.create({
    sequence: '1',
    timestamp: Timestamp.create({ seconds: '1700000003', nanos: 0 }),
    ...input,
    agentId: '',
    ownerUserId,
    realmAgentId,
    localAgentRef,
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

export {
  assert,
  test,
  Struct,
  Timestamp,
  AppMessageEvent,
  AppMessageEventType,
  SendAppMessageRequest,
  SendAppMessageResponse,
  SubscribeAppMessagesRequest,
  RegisterAppRequest,
  RegisterAppResponse,
  AgentEvent,
  AgentEventType,
  AgentExecutionState,
  AgentStateEventFamily,
  ConversationAnchor,
  ConversationAnchorStatus,
  GetConversationAnchorSnapshotRequest,
  GetConversationAnchorSnapshotResponse,
  GetPublicChatSessionSnapshotRequest,
  GetPublicChatSessionSnapshotResponse,
  HookAdmissionState,
  HookEffect,
  HookTriggerFamily,
  OpenConversationAnchorRequest,
  OpenConversationAnchorResponse,
  RegisterAvatarLiveInstanceBindingRequest,
  RegisterAvatarLiveInstanceBindingResponse,
  ResolveAvatarLiveInstanceBindingRequest,
  ResolveAvatarLiveInstanceBindingResponse,
  SubscribeAgentEventsRequest,
  AuthorizeExternalPrincipalRequest,
  AuthorizeExternalPrincipalResponse,
  RuntimeProtoReasonCode,
  Runtime,
  parseAgentConsumeEvent,
  parseAppConsumeEvent,
  RuntimeMethodIds,
  APP_ID,
  OWNER_USER_ID,
  REALM_AGENT_ID,
  LOCAL_AGENT_REF,
  LOCAL_AGENT_IDENTITY,
  OPEN_CONVERSATION_ANCHOR_METHOD,
  GET_CONVERSATION_ANCHOR_SNAPSHOT_METHOD,
  REGISTER_AVATAR_LIVE_INSTANCE_BINDING_METHOD,
  RESOLVE_AVATAR_LIVE_INSTANCE_BINDING_METHOD,
  TIMELINE_STARTED_AT,
  timelineChannelForTestEvent,
  withRuntimeTimeline,
  installNodeGrpcBridge,
  clearNodeGrpcBridge,
  createAnchorSnapshot,
  createAppEvent,
  createAgentEvent,
  collectRuntimeAgentEvents,
};

export type { NodeGrpcBridge, RuntimeAgentConsumeEvent };
