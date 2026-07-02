import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { transformSync } from 'esbuild';

const root = path.resolve(import.meta.dirname, '..');

async function loadModule() {
  const sourcePath = path.join(root, 'src/shell/agent/proposal-intake.ts');
  const source = readFileSync(sourcePath, 'utf8');
  const output = transformSync(source, {
    loader: 'ts',
    format: 'esm',
    target: 'es2022',
  });
  return import(`data:text/javascript;base64,${Buffer.from(output.code).toString('base64')}`);
}

test('submits a conversation-originated capability proposal through SDK proposal intake', async () => {
  const { submitZhiyuCapabilityProposal } = await loadModule();

  const status = await submitZhiyuCapabilityProposal({
    conversation: readyConversation(),
    requestedCapabilityRef: 'capability:text.generate.assistant',
    requiredPermissionRefs: ['permission:runtime.agent.turn.write'],
    sdk: proposalSdk(),
    createProposal: async (draft) => ({
      proposalId: 'proposal:zhiyu:text-generate:1',
      proposalKind: draft.proposalKind,
      sourceConversationAnchorId: draft.sourceConversationAnchorId,
      requesterSubjectRef: draft.requesterSubjectRef,
      ownerDomain: draft.ownerDomain,
      requestedCapabilityRef: draft.requestedCapabilityRef,
      riskTier: draft.riskTier,
      requiredPermissionRefs: draft.requiredPermissionRefs,
      nextReviewStep: draft.nextReviewStep,
      state: 'submitted',
      reasonCode: 'proposal_submitted_for_platform_review',
      auditRef: 'audit:proposal:1',
      createdAt: '2026-07-02T00:00:00.000Z',
    }),
  });

  assert.equal(status.ready, true);
  assert.equal(status.state, 'submitted');
  assert.equal(status.proposalId, 'proposal:zhiyu:text-generate:1');
  assert.equal(status.proposalKind, 'capability_proposal');
  assert.equal(status.ownerDomain, 'Platform');
  assert.equal(status.requestedCapabilityRef, 'capability:text.generate.assistant');
  assert.equal(status.riskTier, 'medium');
  assert.deepEqual(status.requiredPermissionRefs, ['permission:runtime.agent.turn.write']);
  assert.equal(status.nextReviewStep, 'platform_review_capability_proposal');
  assert.equal(status.auditRef, 'audit:proposal:1');
});

test('fails closed when conversation anchor or Platform operation is unavailable', async () => {
  const {
    projectZhiyuProposalIntakeStatus,
    submitZhiyuCapabilityProposal,
  } = await loadModule();

  const blocked = projectZhiyuProposalIntakeStatus({
    conversation: {
      ...readyConversation(),
      ready: false,
      conversationAnchorId: null,
      reasonCode: 'runtime-conversation-anchor-required',
      actionHint: 'open_runtime_conversation_anchor',
    },
  });
  assert.equal(blocked.ready, false);
  assert.equal(blocked.state, 'blocked');
  assert.equal(blocked.reasonCode, 'runtime-conversation-anchor-required');
  assert.equal(blocked.proposalId, null);

  const unavailable = await submitZhiyuCapabilityProposal({
    conversation: readyConversation(),
    requestedCapabilityRef: 'capability:text.generate.assistant',
    requiredPermissionRefs: [],
    sdk: proposalSdk(),
  });
  assert.equal(unavailable.ready, false);
  assert.equal(unavailable.state, 'blocked');
  assert.equal(unavailable.reasonCode, 'SDK_PROPOSAL_INTAKE_OPERATION_UNAVAILABLE');
  assert.equal(unavailable.proposalId, null);
});

test('proposal intake source avoids app-local execution truth', () => {
  const source = readFileSync(path.join(root, 'src/shell/agent/proposal-intake.ts'), 'utf8');
  assert.match(source, /createNimiProposalIntakeClient/);
  assert.doesNotMatch(source, /runtime\/internal|apps\/desktop|localStorage|indexedDB|eval\(|new Function/);
  assert.doesNotMatch(source, /providerName|modelName|installCommand|downloadUrl|executeCommand/);
});

function readyConversation() {
  return {
    transport: 'electron-ipc',
    ready: true,
    reasonCode: 'runtime-conversation-anchor-projected',
    actionHint: 'submit_platform_proposal_intake',
    source: 'runtime-agent-conversation-home',
    message: 'Conversation anchor is projected.',
    ownerUserId: 'user:1',
    runtimeSourceRef: 'runtime-source:1',
    localAgentRef: 'agent:1',
    conversationAnchorId: 'conversation-anchor:zhiyu:1',
  };
}

function proposalSdk() {
  return {
    buildNimiCapabilityProposalDraft(input) {
      return {
        proposalKind: 'capability_proposal',
        sourceConversationAnchorId: input.sourceConversationAnchorId,
        requesterSubjectRef: input.requesterSubjectRef,
        ownerDomain: input.ownerDomain ?? 'Platform',
        requestedCapabilityRef: input.requestedCapabilityRef,
        riskTier: input.riskTier ?? 'medium',
        requiredPermissionRefs: input.requiredPermissionRefs,
        nextReviewStep: input.nextReviewStep ?? 'platform_review_capability_proposal',
        reasonCode: input.reasonCode,
      };
    },
    createNimiProposalIntakeClient(options) {
      return {
        async create(draft) {
          if (!options.createProposal) {
            const error = new Error('Nimi proposal intake requires Platform operation proposal_create.');
            error.reasonCode = 'SDK_PROPOSAL_INTAKE_OPERATION_UNAVAILABLE';
            error.actionHint = 'connect_platform_proposal_create';
            throw error;
          }
          return options.createProposal(draft);
        },
        async get() {
          return undefined;
        },
        async transition() {
          throw new Error('not used');
        },
      };
    },
  };
}
