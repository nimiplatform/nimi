import type {
  AppMessageEvent,
  NimiRuntimeAgentConsumeEvent,
  NimiRuntimeAgentConsumeRuntime,
  NimiRuntimeAgentSessionTurnSnapshot,
} from './index';
import {
  NIMI_RUNTIME_AGENT_RESOLVED_MESSAGE_ACTION_SCHEMA_ID,
  buildNimiRuntimeAgentConsumeContext,
  buildNimiRuntimeAgentResolvedOutputText,
  buildNimiRuntimeAgentSnapshotRecoveryEvents,
  cloneNimiRuntimeAgentResolvedMessageActionEnvelopeWithCommittedMessage,
  createNimiHostRuntimeAgentDelegatedControlSurface,
  createNimiRuntimeAgentConsumeClient,
  isNimiRuntimeAgentProjectionEvent,
  matchesNimiRuntimeAgentProjectionScope,
  nimiRuntimeAgentSnapshotCompletedTurnHasRecoverableContent,
  nimiRuntimeAgentSnapshotTurnIsCompleted,
  nimiRuntimeAgentSnapshotTurnIsFailed,
  nimiRuntimeAgentSnapshotTurnIsTerminal,
  parseNimiRuntimeAgentResolvedMessageActionEnvelopeFromPayload,
  parseNimiRuntimeAgentStructuredMessageActionEnvelope,
  parseNimiRuntimeAgentTimeline,
  projectNimiRuntimeAgentAppMessageEvent,
  readNimiRuntimeAgentStructuredMessageField,
  recoverNimiRuntimeAgentTerminalSnapshot,
  summarizeNimiRuntimeAgentProjectionEvent,
  summarizeNimiRuntimeAgentTimeline,
  toNimiRuntimeProtoStruct,
} from './index';
import {
  AgentEventType,
  ConversationAnchorStatus,
  DelegatedApprovalDecision,
  DelegatedProviderKind,
  DelegatedProviderState,
  DelegatedProviderTrustTier,
  DelegatedTransportKind,
  EffectClass,
  HookAdmissionState,
  SensitivityClass,
} from '../core-generated/runtime-typed-client';

export type {
  AppMessageEvent,
  NimiRuntimeAgentConsumeEvent,
  NimiRuntimeAgentConsumeRuntime,
  NimiRuntimeAgentSessionTurnSnapshot,
};

export {
  AgentEventType,
  ConversationAnchorStatus,
  DelegatedApprovalDecision,
  DelegatedProviderKind,
  DelegatedProviderState,
  DelegatedProviderTrustTier,
  DelegatedTransportKind,
  EffectClass,
  HookAdmissionState,
  NIMI_RUNTIME_AGENT_RESOLVED_MESSAGE_ACTION_SCHEMA_ID,
  SensitivityClass,
  buildNimiRuntimeAgentConsumeContext,
  buildNimiRuntimeAgentResolvedOutputText,
  buildNimiRuntimeAgentSnapshotRecoveryEvents,
  cloneNimiRuntimeAgentResolvedMessageActionEnvelopeWithCommittedMessage,
  createNimiHostRuntimeAgentDelegatedControlSurface,
  createNimiRuntimeAgentConsumeClient,
  isNimiRuntimeAgentProjectionEvent,
  matchesNimiRuntimeAgentProjectionScope,
  nimiRuntimeAgentSnapshotCompletedTurnHasRecoverableContent,
  nimiRuntimeAgentSnapshotTurnIsCompleted,
  nimiRuntimeAgentSnapshotTurnIsFailed,
  nimiRuntimeAgentSnapshotTurnIsTerminal,
  parseNimiRuntimeAgentResolvedMessageActionEnvelopeFromPayload,
  parseNimiRuntimeAgentStructuredMessageActionEnvelope,
  parseNimiRuntimeAgentTimeline,
  projectNimiRuntimeAgentAppMessageEvent,
  readNimiRuntimeAgentStructuredMessageField,
  recoverNimiRuntimeAgentTerminalSnapshot,
  summarizeNimiRuntimeAgentProjectionEvent,
  summarizeNimiRuntimeAgentTimeline,
  toNimiRuntimeProtoStruct,
};

export const consumeContext = {
  runtimeAppId: 'nimi.avatar',
  ownerUserId: 'owner-1',
  runtimeSourceRef: 'agent-1',
  localAgentRef: 'local-agent:test-owner-1-agent-1',
};

export function createUnexpectedRuntimeAgentConsumeRuntime(
  overrides: Partial<NimiRuntimeAgentConsumeRuntime['agents']>,
): NimiRuntimeAgentConsumeRuntime {
  return {
    agents: {
      async openConversationAnchor() {
        throw new Error('unexpected');
      },
      async getConversationAnchorSnapshot() {
        throw new Error('unexpected');
      },
      async getPublicChatSessionSnapshot() {
        throw new Error('unexpected');
      },
      ...overrides,
    },
  };
}

export async function* asyncEvents<T>(events: readonly T[]): AsyncIterable<T> {
  for (const event of events) {
    yield event;
  }
}

export async function collectAsyncIterable<T>(source: AsyncIterable<T>): Promise<T[]> {
  const collected: T[] = [];
  for await (const event of source) {
    collected.push(event);
  }
  return collected;
}
