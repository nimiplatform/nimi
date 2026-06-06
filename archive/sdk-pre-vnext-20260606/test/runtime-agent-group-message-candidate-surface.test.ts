import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createHostRuntimeRealmGroupMessageCandidateSurface,
  RealmGroupMessageCandidateCommitDisposition,
  Timestamp,
} from '../src/runtime/index.js';

function createCandidate() {
  return {
    candidateId: 'candidate-1',
    candidateKind: 'REALM_GROUP_MESSAGE_CANDIDATE',
    candidateEvidenceRef: 'runtime://evidence/candidate-1',
    evidenceHash: 'hash-1',
    runtimeTraceRef: 'runtime://trace/candidate-1',
    realmGroupThreadId: 'group-1',
    realmGroupAgentSlotId: 'slot-1',
    ownerUserId: 'user-1',
    realmAgentId: 'agent-1',
    localAgentRef: 'local-agent:user-1:agent-1',
    triggerRef: 'realm://group-chats/group-1/messages/message-1',
    outputCandidateRef: 'runtime://output/candidate-1',
    auditLineageRef: 'runtime://audit/candidate-1',
    policyVerdictRef: 'runtime://policy/candidate-1',
    createdAt: Timestamp.fromDate(new Date('2026-01-01T00:00:00.000Z')),
    expiresAt: Timestamp.fromDate(new Date('2026-01-01T00:05:00.000Z')),
    commitDisposition: RealmGroupMessageCandidateCommitDisposition.MESSAGE_CANDIDATE,
  };
}

function createEvidence() {
  return {
    candidateId: 'candidate-1',
    candidateKind: 'REALM_GROUP_MESSAGE_CANDIDATE',
    realmGroupThreadId: 'group-1',
    realmGroupAgentSlotId: 'slot-1',
    ownerUserId: 'user-1',
    realmAgentId: 'agent-1',
    localAgentRef: 'local-agent:user-1:agent-1',
    triggerRef: 'realm://group-chats/group-1/messages/message-1',
    outputCandidateRef: 'runtime://output/candidate-1',
    evidenceHash: 'hash-1',
    runtimeTraceRef: 'runtime://trace/candidate-1',
    auditLineageRef: 'runtime://audit/candidate-1',
    policyVerdictRef: 'runtime://policy/candidate-1',
    createdAt: Timestamp.fromDate(new Date('2026-01-01T00:00:00.000Z')),
    expiresAt: Timestamp.fromDate(new Date('2026-01-01T00:05:00.000Z')),
    commitDisposition: RealmGroupMessageCandidateCommitDisposition.MESSAGE_CANDIDATE,
    messageType: 'TEXT',
    body: 'hello group',
    bodyHash: 'body-hash-1',
    refusalCode: '',
    refusalReason: '',
    refusalHash: '',
  };
}

function createRuntime() {
  const calls = {
    registerApp: 0,
    authorizeExternalPrincipal: [] as Array<readonly string[]>,
    createCandidate: [] as Array<Record<string, unknown>>,
    getEvidence: [] as Array<Record<string, unknown>>,
  };
  return {
    calls,
    runtime: {
      appId: 'sdk-test',
      auth: {
        registerApp: async () => {
          calls.registerApp += 1;
          return { accepted: true };
        },
      },
      appAuth: {
        authorizeExternalPrincipal: async (request: { scopes?: readonly string[] }) => {
          calls.authorizeExternalPrincipal.push(request.scopes || []);
          return { tokenId: 'token-id', secret: 'token-secret' };
        },
      },
      agent: {
        createRealmGroupMessageCandidate: async (
          request: Record<string, unknown>,
          options?: Record<string, unknown>,
        ) => {
          calls.createCandidate.push({ ...request, __options: options });
          return { candidate: createCandidate() };
        },
        getRealmGroupMessageCandidateEvidence: async (
          request: Record<string, unknown>,
          options?: Record<string, unknown>,
        ) => {
          calls.getEvidence.push({ ...request, __options: options });
          return { evidence: createEvidence() };
        },
      },
    },
  };
}

test('host Runtime Realm group message candidate surface creates verified Realm commit payload', async () => {
  const { calls, runtime } = createRuntime();
  const surface = createHostRuntimeRealmGroupMessageCandidateSurface({
    getRuntime: () => runtime as never,
    getSubjectUserId: () => 'user-1',
  });

  const result = await surface.createCommitPayload({
    participantType: 'agent',
    currentUserId: 'user-1',
    realmGroupThreadId: 'group-1',
    realmGroupAgentSlotId: 'slot-1',
    ownerUserId: 'user-1',
    realmAgentId: 'agent-1',
    localAgentRef: 'local-agent:user-1:agent-1',
    triggerMessageId: 'message-1',
    idempotencyKey: 'rgmc-1',
  });

  assert.equal(calls.registerApp, 1);
  assert.deepEqual(calls.authorizeExternalPrincipal, [
    ['runtime.agent.create_realm_group_message_candidate'],
    ['runtime.agent.get_realm_group_message_candidate_evidence'],
  ]);
  assert.deepEqual(calls.createCandidate[0]?.context, {
    appId: 'sdk-test',
    subjectUserId: 'user-1',
    ownerUserId: 'user-1',
    realmAgentId: 'agent-1',
    localAgentRef: 'local-agent:user-1:agent-1',
  });
  assert.equal(calls.createCandidate[0]?.triggerRef, 'realm://group-chats/group-1/messages/message-1');
  assert.equal(calls.createCandidate[0]?.membershipSnapshotRef, 'realm://group-chats/group-1/membership/current');
  assert.equal(calls.getEvidence[0]?.candidateEvidenceRef, 'runtime://evidence/candidate-1');
  assert.ok(calls.createCandidate[0]?.__options);
  assert.ok(calls.getEvidence[0]?.__options);
  assert.deepEqual(result.realmCommitPayload, {
    candidateId: 'candidate-1',
    candidateKind: 'REALM_GROUP_MESSAGE_CANDIDATE',
    candidateEvidenceRef: 'runtime://evidence/candidate-1',
    evidenceHash: 'hash-1',
    runtimeTraceRef: 'runtime://trace/candidate-1',
    expectedRealmGroupAgentSlotId: 'slot-1',
    expectedLocalAgentRef: 'local-agent:user-1:agent-1',
    triggerRef: 'realm://group-chats/group-1/messages/message-1',
    outputCandidateRef: 'runtime://output/candidate-1',
    auditLineageRef: 'runtime://audit/candidate-1',
    policyVerdictRef: 'runtime://policy/candidate-1',
    createdAt: '2026-01-01T00:00:00.000Z',
    expiresAt: '2026-01-01T00:05:00.000Z',
    commitDisposition: 'MESSAGE_CANDIDATE',
    messageType: 'TEXT',
    body: 'hello group',
    bodyHash: 'body-hash-1',
    idempotencyKey: 'rgmc-1',
    clientCorrelationId: 'rgmc-1',
  });
});

test('host Runtime Realm group message candidate surface rejects slot identity drift', async () => {
  const { runtime } = createRuntime();
  const surface = createHostRuntimeRealmGroupMessageCandidateSurface({
    getRuntime: () => runtime as never,
    getSubjectUserId: () => 'user-1',
  });

  await assert.rejects(() => surface.createCommitPayload({
    participantType: 'human',
    currentUserId: 'user-1',
    realmGroupThreadId: 'group-1',
    realmGroupAgentSlotId: 'slot-1',
    ownerUserId: 'user-1',
    realmAgentId: 'agent-1',
    localAgentRef: 'local-agent:user-1:agent-1',
    triggerMessageId: 'message-1',
    idempotencyKey: 'rgmc-1',
  }), /Realm group agent candidate handoff requires a Realm projected agent slot/);
});

test('host Runtime Realm group message candidate surface rejects mismatched evidence', async () => {
  const { runtime } = createRuntime();
  runtime.agent.getRealmGroupMessageCandidateEvidence = async () => ({
    evidence: {
      ...createEvidence(),
      evidenceHash: 'wrong-hash',
    },
  });
  const surface = createHostRuntimeRealmGroupMessageCandidateSurface({
    getRuntime: () => runtime as never,
    getSubjectUserId: () => 'user-1',
  });

  await assert.rejects(() => surface.createCommitPayload({
    participantType: 'agent',
    currentUserId: 'user-1',
    realmGroupThreadId: 'group-1',
    realmGroupAgentSlotId: 'slot-1',
    ownerUserId: 'user-1',
    realmAgentId: 'agent-1',
    localAgentRef: 'local-agent:user-1:agent-1',
    triggerMessageId: 'message-1',
    idempotencyKey: 'rgmc-1',
  }), /candidate evidence does not match/);
});
