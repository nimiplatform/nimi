import assert from 'node:assert/strict';
import test from 'node:test';

import type {
  CreateRealmGroupMessageCandidateRequest,
  GetRealmGroupMessageCandidateEvidenceRequest,
} from '../core-generated/runtime-typed-client';
import {
  RealmGroupMessageCandidateCommitDisposition,
} from '../core-generated/runtime-typed-client';
import {
  createNimiHostRuntimeRealmGroupMessageCandidateSurface,
} from './runtime-agent-group-message';

const OWNER_USER_ID = 'user-1';
const RUNTIME_SOURCE_REF = 'agent-1';
const LOCAL_AGENT_REF = 'local-agent:test-user-1-agent-1';

test('Runtime Realm group message candidate surface builds verified commit payloads and rejects mismatched evidence', async () => {
  const createCalls: CreateRealmGroupMessageCandidateRequest[] = [];
  const evidenceCalls: GetRealmGroupMessageCandidateEvidenceRequest[] = [];
  let candidate = candidateHandle();
  let evidence = candidateEvidence();
  const surface = createNimiHostRuntimeRealmGroupMessageCandidateSurface({
    getRuntime: () => ({
      appId: 'desktop',
      auth: protectedAuth(),
      agent: {
        async createRealmGroupMessageCandidate(request) {
          createCalls.push(request);
          return { candidate };
        },
        async getRealmGroupMessageCandidateEvidence(request) {
          evidenceCalls.push(request);
          return { evidence };
        },
      },
    }),
    getSubjectUserId: () => 'user-1',
    withScopes: async (scopes, operation) => operation({ metadata: { scopes: scopes.join(' ') } }),
  });

  const result = await surface.createCommitPayload({
    ...agentIdentity(),
    participantType: 'source',
    currentUserId: 'user-1',
    runtimeParticipantSlot: 'slot-1',
    realmGroupThreadId: 'thread-1',
    triggerMessageId: 'message-1',
    triggerKind: 'mention',
    idempotencyKey: 'idem-1',
  });

  assert.equal(createCalls[0]?.triggerRef, 'realm://group-chats/thread-1/messages/message-1');
  assert.equal(createCalls[0]?.contextRefs['realm.group.thread.snapshot'], 'realm-context://group-chats/thread-1/thread/current');
  assert.equal('custom' in (createCalls[0]?.contextRefs ?? {}), false);
  assert.equal(evidenceCalls[0]?.candidateId, 'candidate-1');
  assert.equal(result.realmCommitPayload.commitDisposition, 'MESSAGE_CANDIDATE');
  assert.equal(result.realmCommitPayload.body, 'hello group');
  assert.equal(result.realmCommitPayload.idempotencyKey, 'idem-1');
  assert.equal(result.realmCommitPayload.expectedRuntimeParticipantSlotId, 'slot-1');
  assert.equal(result.realmCommitPayload.expectedRuntimeSourceRef, 'agent-1');
  assert.deepEqual(result.realmCommitPayload.triggerEvidence, {
    kind: 'mention',
    triggerRef: 'realm://group-chats/thread-1/messages/message-1',
    actorId: 'user-1',
    chatId: 'thread-1',
    messageId: 'message-1',
  });
  assert.equal('triggerRef' in result.realmCommitPayload, false);
  assert.equal(result.realmCommitPayload.createdAt, '2026-06-05T00:00:00.000Z');

  candidate = {
    ...candidateHandle(),
    candidateId: 'candidate-2',
    candidateEvidenceRef: 'evidence-ref-2',
    evidenceHash: 'hash-2',
    runtimeTraceRef: 'trace-2',
    triggerRef: 'realm://group-chats/thread-1/messages/message-2',
  };
  evidence = {
    ...candidateEvidence(),
    candidateId: 'candidate-2',
    evidenceHash: 'hash-2',
    runtimeTraceRef: 'trace-2',
    triggerRef: 'realm://group-chats/thread-1/messages/message-2',
  };
  const explicitAction = await surface.createCommitPayload({
    ...agentIdentity(),
    participantType: 'source',
    currentUserId: 'user-1',
    runtimeParticipantSlot: 'slot-1',
    realmGroupThreadId: 'thread-1',
    triggerMessageId: 'message-2',
    triggerKind: 'explicitUserAction',
    idempotencyKey: 'idem-explicit',
  });
  assert.equal(explicitAction.realmCommitPayload.triggerEvidence.kind, 'explicitUserAction');

  candidate = candidateHandle();
  evidence = candidateEvidence();
  await assert.rejects(
    () => surface.createCommitPayload({
      ...agentIdentity(),
      participantType: 'source',
      currentUserId: 'user-1',
      runtimeParticipantSlot: 'slot-1',
      realmGroupThreadId: 'thread-1',
      triggerMessageId: 'message-1',
      idempotencyKey: 'idem-missing-trigger-kind',
    } as never),
    /trigger kind/,
  );

  candidate = candidateHandle();
  evidence = { ...candidateEvidence(), candidateId: 'other-candidate' };
  await assert.rejects(
    () => surface.createCommitPayload({
      ...agentIdentity(),
      participantType: 'source',
      currentUserId: 'user-1',
      runtimeParticipantSlot: 'slot-1',
      realmGroupThreadId: 'thread-1',
      triggerMessageId: 'message-1',
      triggerKind: 'mention',
      idempotencyKey: 'idem-2',
    }),
    /evidence does not match the candidate handle/,
  );

  await assert.rejects(
    () => surface.createCommitPayload({
      ...agentIdentity(),
      participantType: 'source',
      currentUserId: 'user-1',
      runtimeParticipantSlot: 'slot-1',
      realmGroupThreadId: 'thread-1',
      triggerMessageId: 'message-1',
      triggerKind: 'mention',
      idempotencyKey: 'idem-3',
      contextRefs: { custom: 'realm-context://custom' },
    } as never),
    /context refs are Runtime-owned/,
  );
});

function agentIdentity() {
  return {
    ownerUserId: OWNER_USER_ID,
    runtimeSourceRef: RUNTIME_SOURCE_REF,
    localAgentRef: LOCAL_AGENT_REF,
  };
}

function protectedAuth() {
  return {
    async registerApp() {
      return { accepted: true };
    },
  };
}

function timestamp(iso: string): { readonly seconds: string; readonly nanos: number } {
  const millis = Date.parse(iso);
  return {
    seconds: String(Math.floor(millis / 1000)),
    nanos: (millis % 1000) * 1_000_000,
  };
}

function candidateHandle() {
  return {
    candidateId: 'candidate-1',
    candidateKind: 'REALM_GROUP_MESSAGE_CANDIDATE',
    candidateEvidenceRef: 'evidence-ref-1',
    evidenceHash: 'hash-1',
    runtimeTraceRef: 'trace-1',
    realmGroupThreadId: 'thread-1',
    runtimeParticipantSlot: 'slot-1',
    ownerUserId: OWNER_USER_ID,
    runtimeSourceRef: RUNTIME_SOURCE_REF,
    localAgentRef: LOCAL_AGENT_REF,
    triggerRef: 'realm://group-chats/thread-1/messages/message-1',
    outputCandidateRef: 'candidate-output-1',
    auditLineageRef: 'audit-1',
    policyVerdictRef: 'policy-1',
    createdAt: timestamp('2026-06-05T00:00:00.000Z'),
    expiresAt: timestamp('2026-06-05T00:05:00.000Z'),
    commitDisposition: RealmGroupMessageCandidateCommitDisposition.MESSAGE_CANDIDATE,
  };
}

function candidateEvidence() {
  return {
    candidateId: 'candidate-1',
    candidateKind: 'REALM_GROUP_MESSAGE_CANDIDATE',
    realmGroupThreadId: 'thread-1',
    runtimeParticipantSlot: 'slot-1',
    ownerUserId: OWNER_USER_ID,
    runtimeSourceRef: RUNTIME_SOURCE_REF,
    localAgentRef: LOCAL_AGENT_REF,
    triggerRef: 'realm://group-chats/thread-1/messages/message-1',
    outputCandidateRef: 'candidate-output-1',
    evidenceHash: 'hash-1',
    runtimeTraceRef: 'trace-1',
    auditLineageRef: 'audit-1',
    policyVerdictRef: 'policy-1',
    createdAt: timestamp('2026-06-05T00:00:00.000Z'),
    expiresAt: timestamp('2026-06-05T00:05:00.000Z'),
    commitDisposition: RealmGroupMessageCandidateCommitDisposition.MESSAGE_CANDIDATE,
    messageType: 'TEXT',
    body: 'hello group',
    bodyHash: 'body-hash-1',
    refusalCode: '',
    refusalReason: '',
    refusalHash: '',
  };
}
