import type {
  NimiCapabilityProposalDraftInput,
  NimiProposalIntakeClient,
  NimiProposalIntakeClientOptions,
  NimiProposalIntakeDraft,
  NimiProposalIntakeRecord,
} from '@nimiplatform/sdk/runtime';
import type { ZhiyuEvidence } from '../app/evidence';

export type ZhiyuProposalIntakeState =
  | 'draft'
  | 'submitted'
  | 'under-review'
  | 'revision-requested'
  | 'rejected'
  | 'accepted-for-admission'
  | 'blocked';

export type ZhiyuProposalIntakeStatus = {
  readonly transport: 'sdk-proposal-intake';
  readonly ready: boolean;
  readonly state: ZhiyuProposalIntakeState;
  readonly reasonCode: string;
  readonly actionHint: string;
  readonly source: string;
  readonly message: string;
  readonly proposalId: string | null;
  readonly proposalKind: string;
  readonly sourceConversationAnchorId: string | null;
  readonly requesterSubjectRef: string | null;
  readonly ownerDomain: string;
  readonly requestedCapabilityRef: string;
  readonly riskTier: string;
  readonly requiredPermissionRefs: readonly string[];
  readonly nextReviewStep: string;
  readonly auditRef: string | null;
  readonly createdAt: string | null;
};

type ZhiyuConversationEvidence = ZhiyuEvidence['conversation'];
type ZhiyuProposalIntakeSdk = {
  readonly buildNimiCapabilityProposalDraft: (
    input: NimiCapabilityProposalDraftInput,
  ) => NimiProposalIntakeDraft;
  readonly createNimiProposalIntakeClient: (
    options: NimiProposalIntakeClientOptions,
  ) => NimiProposalIntakeClient;
};

const DEFAULT_REQUESTED_CAPABILITY_REF = 'capability:text.generate.assistant';
const DEFAULT_PERMISSION_REFS = ['permission:runtime.agent.turn.write'] as const;

export function projectZhiyuProposalIntakeStatus(input: {
  readonly conversation: ZhiyuConversationEvidence;
  readonly record?: NimiProposalIntakeRecord | null;
  readonly requestedCapabilityRef?: string;
  readonly requiredPermissionRefs?: readonly string[];
}): ZhiyuProposalIntakeStatus {
  if (input.record) {
    return statusFromRecord(input.record);
  }
  if (!input.conversation.ready || !input.conversation.conversationAnchorId || !input.conversation.agentHandle) {
    return blockedStatus({
      conversation: input.conversation,
      reasonCode: input.conversation.reasonCode || 'zhiyu-conversation-anchor-required',
      actionHint: input.conversation.actionHint || 'open_runtime_conversation_anchor',
      message: 'Proposal intake waits for a Runtime-owned conversation anchor.',
      requestedCapabilityRef: input.requestedCapabilityRef,
      requiredPermissionRefs: input.requiredPermissionRefs,
    });
  }
  return blockedStatus({
    conversation: input.conversation,
    reasonCode: 'zhiyu-proposal-intake-operation-not-connected',
    actionHint: 'connect_platform_proposal_intake',
    message: 'Platform proposal intake is admitted but no Platform operation is connected.',
    requestedCapabilityRef: input.requestedCapabilityRef,
    requiredPermissionRefs: input.requiredPermissionRefs,
  });
}

export async function submitZhiyuCapabilityProposal(input: {
  readonly conversation: ZhiyuConversationEvidence;
  readonly requestedCapabilityRef?: string;
  readonly requiredPermissionRefs?: readonly string[];
  readonly createProposal?: NimiProposalIntakeClientOptions['createProposal'];
  readonly sdk?: ZhiyuProposalIntakeSdk;
}): Promise<ZhiyuProposalIntakeStatus> {
  if (!input.conversation.ready || !input.conversation.conversationAnchorId || !input.conversation.agentHandle) {
    return projectZhiyuProposalIntakeStatus(input);
  }
  const requestedCapabilityRef = input.requestedCapabilityRef ?? DEFAULT_REQUESTED_CAPABILITY_REF;
  const requiredPermissionRefs = input.requiredPermissionRefs ?? DEFAULT_PERMISSION_REFS;
  const sdk = input.sdk ?? await import('@nimiplatform/sdk/runtime') as ZhiyuProposalIntakeSdk;
  const client = sdk.createNimiProposalIntakeClient({
    createProposal: input.createProposal,
  });
  try {
    const record = await client.create(sdk.buildNimiCapabilityProposalDraft({
      sourceConversationAnchorId: input.conversation.conversationAnchorId,
      requesterSubjectRef: input.conversation.agentHandle,
      requestedCapabilityRef,
      requiredPermissionRefs,
    }));
    return statusFromRecord(record);
  } catch (error) {
    return blockedStatus({
      conversation: input.conversation,
      reasonCode: reasonCodeFromError(error),
      actionHint: actionHintFromError(error),
      message: messageFromError(error),
      requestedCapabilityRef,
      requiredPermissionRefs,
    });
  }
}

function statusFromRecord(record: NimiProposalIntakeRecord): ZhiyuProposalIntakeStatus {
  return {
    transport: 'sdk-proposal-intake',
    ready: record.state !== 'blocked' && record.state !== 'rejected',
    state: record.state,
    reasonCode: record.reasonCode,
    actionHint: record.nextReviewStep,
    source: 'sdk-proposal-intake',
    message: `Proposal intake ${record.state}: ${record.reasonCode}`,
    proposalId: record.proposalId,
    proposalKind: record.proposalKind,
    sourceConversationAnchorId: record.sourceConversationAnchorId,
    requesterSubjectRef: record.requesterSubjectRef,
    ownerDomain: record.ownerDomain,
    requestedCapabilityRef: record.requestedCapabilityRef,
    riskTier: record.riskTier,
    requiredPermissionRefs: record.requiredPermissionRefs,
    nextReviewStep: record.nextReviewStep,
    auditRef: record.auditRef,
    createdAt: record.createdAt,
  };
}

function blockedStatus(input: {
  readonly conversation: ZhiyuConversationEvidence;
  readonly reasonCode: string;
  readonly actionHint: string;
  readonly message: string;
  readonly requestedCapabilityRef?: string;
  readonly requiredPermissionRefs?: readonly string[];
}): ZhiyuProposalIntakeStatus {
  return {
    transport: 'sdk-proposal-intake',
    ready: false,
    state: 'blocked',
    reasonCode: input.reasonCode,
    actionHint: input.actionHint,
    source: 'sdk-proposal-intake',
    message: input.message,
    proposalId: null,
    proposalKind: 'capability_proposal',
    sourceConversationAnchorId: input.conversation.conversationAnchorId,
    requesterSubjectRef: input.conversation.agentHandle,
    ownerDomain: 'Platform',
    requestedCapabilityRef: input.requestedCapabilityRef ?? DEFAULT_REQUESTED_CAPABILITY_REF,
    riskTier: 'medium',
    requiredPermissionRefs: input.requiredPermissionRefs ?? DEFAULT_PERMISSION_REFS,
    nextReviewStep: 'platform_review_capability_proposal',
    auditRef: null,
    createdAt: null,
  };
}

function reasonCodeFromError(error: unknown): string {
  const reasonCode = typeof error === 'object' && error && 'reasonCode' in error
    ? String((error as { reasonCode?: unknown }).reasonCode ?? '').trim()
    : '';
  return reasonCode || 'zhiyu-proposal-intake-failed';
}

function actionHintFromError(error: unknown): string {
  const actionHint = typeof error === 'object' && error && 'actionHint' in error
    ? String((error as { actionHint?: unknown }).actionHint ?? '').trim()
    : '';
  return actionHint || 'connect_platform_proposal_intake';
}

function messageFromError(error: unknown): string {
  return error instanceof Error
    ? error.message
    : 'Proposal intake failed closed.';
}
