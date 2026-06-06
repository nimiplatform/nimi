import { createNimiHostRuntimeRealmGroupMessageCandidateSurface, toNimiRuntimeTimestamp } from '@nimiplatform/sdk/runtime';
import { RealmGroupMessageCandidateCommitDisposition } from '@nimiplatform/sdk/runtime/generated';

export async function inspectTesterRuntimeAgentGroupMessageCandidateSurface(): Promise<{
  createScope: string;
  evidenceScope: string;
  candidateId: string;
  commitDisposition: string;
  body: string;
}> {
  const scopes: string[] = [];
  const surface = createNimiHostRuntimeRealmGroupMessageCandidateSurface({
    getRuntime: () => ({
      appId: 'nimi.tester',
      auth: {
        registerApp: async () => ({ accepted: true }),
      },
      appAuth: {
        authorizeExternalPrincipal: async (request: { scopes?: readonly string[] }) => {
          scopes.push((request.scopes || []).join(','));
          return {
            tokenId: 'tester-token',
            secret: 'tester-secret',
          };
        },
      },
      agent: {
        createRealmGroupMessageCandidate: async () => ({
          candidate: {
            candidateId: 'tester-candidate',
            candidateKind: 'REALM_GROUP_MESSAGE_CANDIDATE',
            candidateEvidenceRef: 'runtime://tester/evidence',
            evidenceHash: 'tester-hash',
            runtimeTraceRef: 'runtime://tester/trace',
            realmGroupThreadId: 'tester-group',
            realmGroupAgentSlotId: 'tester-slot',
            ownerUserId: 'tester-user',
            realmAgentId: 'tester-agent',
            localAgentRef: 'local-agent:tester-user:tester-agent',
            triggerRef: 'realm://group-chats/tester-group/messages/tester-message',
            outputCandidateRef: 'runtime://tester/output',
            auditLineageRef: 'runtime://tester/audit',
            policyVerdictRef: 'runtime://tester/policy',
            createdAt: toNimiRuntimeTimestamp(new Date('2026-01-01T00:00:00.000Z')),
            expiresAt: toNimiRuntimeTimestamp(new Date('2026-01-01T00:05:00.000Z')),
            commitDisposition: RealmGroupMessageCandidateCommitDisposition.MESSAGE_CANDIDATE,
          },
        }),
        getRealmGroupMessageCandidateEvidence: async () => ({
          evidence: {
            candidateId: 'tester-candidate',
            candidateKind: 'REALM_GROUP_MESSAGE_CANDIDATE',
            realmGroupThreadId: 'tester-group',
            realmGroupAgentSlotId: 'tester-slot',
            ownerUserId: 'tester-user',
            realmAgentId: 'tester-agent',
            localAgentRef: 'local-agent:tester-user:tester-agent',
            triggerRef: 'realm://group-chats/tester-group/messages/tester-message',
            outputCandidateRef: 'runtime://tester/output',
            evidenceHash: 'tester-hash',
            runtimeTraceRef: 'runtime://tester/trace',
            auditLineageRef: 'runtime://tester/audit',
            policyVerdictRef: 'runtime://tester/policy',
            createdAt: toNimiRuntimeTimestamp(new Date('2026-01-01T00:00:00.000Z')),
            expiresAt: toNimiRuntimeTimestamp(new Date('2026-01-01T00:05:00.000Z')),
            commitDisposition: RealmGroupMessageCandidateCommitDisposition.MESSAGE_CANDIDATE,
            messageType: 'TEXT',
            body: 'tester body',
            bodyHash: 'tester-body-hash',
            refusalCode: '',
            refusalReason: '',
            refusalHash: '',
          },
        }),
      },
    }) as never,
    getSubjectUserId: () => 'tester-user',
  });
  const result = await surface.createCommitPayload({
    participantType: 'agent',
    currentUserId: 'tester-user',
    realmGroupThreadId: 'tester-group',
    realmGroupAgentSlotId: 'tester-slot',
    ownerUserId: 'tester-user',
    realmAgentId: 'tester-agent',
    localAgentRef: 'local-agent:tester-user:tester-agent',
    triggerMessageId: 'tester-message',
    idempotencyKey: 'tester-idempotency',
  });
  return {
    createScope: scopes[0] || '',
    evidenceScope: scopes[1] || '',
    candidateId: result.realmCommitPayload.candidateId,
    commitDisposition: result.realmCommitPayload.commitDisposition,
    body: result.realmCommitPayload.body || '',
  };
}
