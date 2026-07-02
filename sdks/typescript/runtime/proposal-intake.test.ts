import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildNimiCapabilityProposalDraft,
  createNimiProposalIntakeClient,
  type NimiProposalIntakeRecord,
} from './proposal-intake';

const submittedRecord: NimiProposalIntakeRecord = {
  proposalId: 'proposal:zhiyu:text-generate:1',
  proposalKind: 'capability_proposal',
  sourceConversationAnchorId: 'conversation-anchor:zhiyu:1',
  requesterSubjectRef: 'subject:user:1',
  ownerDomain: 'Platform',
  requestedCapabilityRef: 'capability:text.generate.assistant',
  riskTier: 'medium',
  requiredPermissionRefs: ['permission:runtime.agent.turn.write'],
  nextReviewStep: 'platform_review_capability_proposal',
  state: 'submitted',
  reasonCode: 'proposal_submitted_for_platform_review',
  auditRef: 'audit:proposal:1',
  createdAt: '2026-07-02T00:00:00.000Z',
};

test('proposal intake client submits a Platform-backed non-executing proposal record', async () => {
  const client = createNimiProposalIntakeClient({
    createProposal: async (draft) => ({
      ...submittedRecord,
      sourceConversationAnchorId: draft.sourceConversationAnchorId,
      requesterSubjectRef: draft.requesterSubjectRef,
      requestedCapabilityRef: draft.requestedCapabilityRef,
      requiredPermissionRefs: draft.requiredPermissionRefs,
    }),
  });

  const proposal = await client.create(buildNimiCapabilityProposalDraft({
    sourceConversationAnchorId: 'conversation-anchor:zhiyu:1',
    requesterSubjectRef: 'subject:user:1',
    requestedCapabilityRef: 'capability:text.generate.assistant',
    requiredPermissionRefs: ['permission:runtime.agent.turn.write'],
  }));

  assert.equal(proposal.proposalKind, 'capability_proposal');
  assert.equal(proposal.ownerDomain, 'Platform');
  assert.equal(proposal.requestedCapabilityRef, 'capability:text.generate.assistant');
  assert.equal(proposal.riskTier, 'medium');
  assert.deepEqual(proposal.requiredPermissionRefs, ['permission:runtime.agent.turn.write']);
  assert.equal(proposal.nextReviewStep, 'platform_review_capability_proposal');
  assert.equal(proposal.state, 'submitted');
  assert.equal(proposal.auditRef, 'audit:proposal:1');
  assert.equal(Object.hasOwn(proposal, 'execute'), false);
});

test('proposal intake client fails closed when the Platform operation is absent', async () => {
  const client = createNimiProposalIntakeClient({});

  await assert.rejects(
    () => client.create(buildNimiCapabilityProposalDraft({
      sourceConversationAnchorId: 'conversation-anchor:zhiyu:1',
      requesterSubjectRef: 'subject:user:1',
      requestedCapabilityRef: 'capability:text.generate.assistant',
      requiredPermissionRefs: [],
    })),
    (error: unknown) => {
      assert.equal((error as { reasonCode?: string }).reasonCode, 'SDK_PROPOSAL_INTAKE_OPERATION_UNAVAILABLE');
      return true;
    },
  );
});

test('proposal intake rejects retired alias requests unless the proposal is an explicit rejection', async () => {
  const client = createNimiProposalIntakeClient({
    createProposal: async (draft) => ({
      ...submittedRecord,
      proposalKind: draft.proposalKind,
      sourceConversationAnchorId: draft.sourceConversationAnchorId,
      requesterSubjectRef: draft.requesterSubjectRef,
      ownerDomain: draft.ownerDomain,
      requestedCapabilityRef: draft.requestedCapabilityRef,
      riskTier: draft.riskTier,
      requiredPermissionRefs: draft.requiredPermissionRefs,
      nextReviewStep: draft.nextReviewStep,
      state: draft.proposalKind === 'rejected_request' ? 'rejected' : 'submitted',
      reasonCode: draft.reasonCode ?? submittedRecord.reasonCode,
    }),
  });

  await assert.rejects(
    () => client.create({
      proposalKind: 'capability_proposal',
      sourceConversationAnchorId: 'conversation-anchor:zhiyu:1',
      requesterSubjectRef: 'subject:user:1',
      ownerDomain: 'Platform',
      requestedCapabilityRef: 'plugin:calendar-writer',
      riskTier: 'medium',
      requiredPermissionRefs: [],
      nextReviewStep: 'platform_review_capability_proposal',
    }),
    (error: unknown) => {
      assert.equal((error as { reasonCode?: string }).reasonCode, 'SDK_PROPOSAL_INTAKE_FORBIDDEN_ALIAS');
      return true;
    },
  );

  const rejected = await client.create({
    proposalKind: 'rejected_request',
    sourceConversationAnchorId: 'conversation-anchor:zhiyu:1',
    requesterSubjectRef: 'subject:user:1',
    ownerDomain: 'Platform',
    requestedCapabilityRef: 'rejected:retired-alias',
    riskTier: 'blocked',
    requiredPermissionRefs: [],
    nextReviewStep: 'record_rejection_reason',
    reasonCode: 'proposal_retired_surface_alias_forbidden',
  });

  assert.equal(rejected.proposalKind, 'rejected_request');
  assert.equal(rejected.state, 'rejected');
});

test('proposal intake rejects records that try to carry execution fields', async () => {
  const client = createNimiProposalIntakeClient({
    createProposal: async () => ({
      ...submittedRecord,
      executeCommand: 'run-hidden-tool',
    } as unknown as NimiProposalIntakeRecord),
  });

  await assert.rejects(
    () => client.create(buildNimiCapabilityProposalDraft({
      sourceConversationAnchorId: 'conversation-anchor:zhiyu:1',
      requesterSubjectRef: 'subject:user:1',
      requestedCapabilityRef: 'capability:text.generate.assistant',
      requiredPermissionRefs: [],
    })),
    (error: unknown) => {
      assert.equal((error as { reasonCode?: string }).reasonCode, 'SDK_PROPOSAL_INTAKE_EXECUTION_FIELD_FORBIDDEN');
      return true;
    },
  );
});
