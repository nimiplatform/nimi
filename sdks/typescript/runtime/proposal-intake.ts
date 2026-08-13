import { createNimiError } from '../types';

export type NimiProposalKind =
  | 'capability_proposal'
  | 'workflow_draft_request'
  | 'nimi_app_request'
  | 'delegated_tool_request'
  | 'rejected_request';

export type NimiProposalState =
  | 'draft'
  | 'submitted'
  | 'under-review'
  | 'revision-requested'
  | 'rejected'
  | 'accepted-for-admission'
  | 'blocked';

export type NimiProposalRiskTier = 'low' | 'medium' | 'high' | 'blocked';

export interface NimiProposalIntakeDraft {
  readonly proposalKind: NimiProposalKind;
  readonly sourceConversationAnchorId: string;
  readonly requesterSubjectRef: string;
  readonly ownerDomain: string;
  readonly requestedCapabilityRef: string;
  readonly riskTier: NimiProposalRiskTier;
  readonly requiredPermissionRefs: readonly string[];
  readonly nextReviewStep: string;
  readonly reasonCode?: string;
}

export interface NimiCapabilityProposalDraftInput {
  readonly sourceConversationAnchorId: string;
  readonly requesterSubjectRef: string;
  readonly requestedCapabilityRef: string;
  readonly requiredPermissionRefs: readonly string[];
  readonly ownerDomain?: string;
  readonly riskTier?: NimiProposalRiskTier;
  readonly nextReviewStep?: string;
  readonly reasonCode?: string;
}

export interface NimiProposalIntakeRecord {
  readonly proposalId: string;
  readonly proposalKind: NimiProposalKind;
  readonly sourceConversationAnchorId: string;
  readonly requesterSubjectRef: string;
  readonly ownerDomain: string;
  readonly requestedCapabilityRef: string;
  readonly riskTier: NimiProposalRiskTier;
  readonly requiredPermissionRefs: readonly string[];
  readonly nextReviewStep: string;
  readonly state: NimiProposalState;
  readonly reasonCode: string;
  readonly auditRef: string;
  readonly createdAt: string;
}

export interface NimiProposalTransitionInput {
  readonly proposalId: string;
  readonly toState: NimiProposalState;
  readonly reasonCode: string;
  readonly auditRef?: string;
}

export interface NimiProposalIntakeClientOptions {
  readonly createProposal?: (
    draft: NimiProposalIntakeDraft,
  ) => Promise<NimiProposalIntakeRecord> | NimiProposalIntakeRecord;
  readonly getProposal?: (
    proposalId: string,
  ) => Promise<NimiProposalIntakeRecord | undefined> | NimiProposalIntakeRecord | undefined;
  readonly transitionProposal?: (
    transition: NimiProposalTransitionInput,
  ) => Promise<NimiProposalIntakeRecord> | NimiProposalIntakeRecord;
}

export interface NimiProposalIntakeClient {
  create(draft: NimiProposalIntakeDraft): Promise<NimiProposalIntakeRecord>;
  get(proposalId: string): Promise<NimiProposalIntakeRecord | undefined>;
  transition(transition: NimiProposalTransitionInput): Promise<NimiProposalIntakeRecord>;
}

const PROPOSAL_KINDS = new Set<NimiProposalKind>([
  'capability_proposal',
  'workflow_draft_request',
  'nimi_app_request',
  'delegated_tool_request',
  'rejected_request',
]);

const PROPOSAL_STATES = new Set<NimiProposalState>([
  'draft',
  'submitted',
  'under-review',
  'revision-requested',
  'rejected',
  'accepted-for-admission',
  'blocked',
]);

const RISK_TIERS = new Set<NimiProposalRiskTier>(['low', 'medium', 'high', 'blocked']);

const RETIRED_ALIAS_PATTERNS = [
  /\bplugin:/iu,
  /\bworker:/iu,
  /\bvm:/iu,
  /\bcontent[-_ ]pack:/iu,
  /\bextension:/iu,
  /\bmod:/iu,
  /\bsandboxed[-_ ]worker\b/iu,
];

const FORBIDDEN_FIELD_NAME_PATTERN = /(?:execute|execution|install|download|provider|model|command|localpath|filesystempath|runtimeinternal|toolarguments)/iu;

function proposalError(message: string, reasonCode: string, actionHint: string): never {
  throw createNimiError({
    message,
    reasonCode,
    actionHint,
    source: 'sdk',
  });
}

function normalizeText(value: unknown): string {
  return String(value ?? '').trim();
}

function requireText(value: unknown, field: string): string {
  const normalized = normalizeText(value);
  if (!normalized) {
    proposalError(
      `Nimi proposal intake requires ${field}.`,
      'SDK_PROPOSAL_INTAKE_INPUT_INVALID',
      `provide_${field}`,
    );
  }
  return normalized;
}

function normalizeStringList(value: unknown, field: string): readonly string[] {
  if (!Array.isArray(value)) {
    proposalError(
      `Nimi proposal intake requires ${field} as a list.`,
      'SDK_PROPOSAL_INTAKE_INPUT_INVALID',
      `provide_${field}`,
    );
  }
  return value.map((item) => requireText(item, field));
}

function normalizeProposalKind(value: unknown): NimiProposalKind {
  const normalized = normalizeText(value) as NimiProposalKind;
  if (!PROPOSAL_KINDS.has(normalized)) {
    proposalError(
      `Nimi proposal intake kind is not admitted: ${normalized || '<empty>'}.`,
      'SDK_PROPOSAL_INTAKE_KIND_INVALID',
      'use_admitted_proposal_kind',
    );
  }
  return normalized;
}

function normalizeProposalState(value: unknown): NimiProposalState {
  const normalized = normalizeText(value) as NimiProposalState;
  if (!PROPOSAL_STATES.has(normalized)) {
    proposalError(
      `Nimi proposal intake state is not admitted: ${normalized || '<empty>'}.`,
      'SDK_PROPOSAL_INTAKE_STATE_INVALID',
      'use_admitted_proposal_state',
    );
  }
  return normalized;
}

function normalizeRiskTier(value: unknown): NimiProposalRiskTier {
  const normalized = normalizeText(value) as NimiProposalRiskTier;
  if (!RISK_TIERS.has(normalized)) {
    proposalError(
      `Nimi proposal intake risk tier is not admitted: ${normalized || '<empty>'}.`,
      'SDK_PROPOSAL_INTAKE_RISK_TIER_INVALID',
      'use_admitted_proposal_risk_tier',
    );
  }
  return normalized;
}

function containsRetiredAlias(value: string): boolean {
  return RETIRED_ALIAS_PATTERNS.some((pattern) => pattern.test(value));
}

function assertRetiredAliasBoundary(input: {
  readonly proposalKind: NimiProposalKind;
  readonly state?: NimiProposalState;
  readonly requestedCapabilityRef: string;
  readonly reasonCode?: string;
}) {
  if (!containsRetiredAlias(input.requestedCapabilityRef)) {
    return;
  }
  const explicitlyClosed = input.proposalKind === 'rejected_request'
    || input.state === 'blocked'
    || input.state === 'rejected';
  if (!explicitlyClosed || !normalizeText(input.reasonCode)) {
    proposalError(
      'Nimi proposal intake cannot route retired alias requests as active proposals.',
      'SDK_PROPOSAL_INTAKE_FORBIDDEN_ALIAS',
      'return_rejected_or_blocked_proposal',
    );
  }
}

function assertNoForbiddenRecordFields(value: unknown, path: string) {
  if (!value || typeof value !== 'object') {
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoForbiddenRecordFields(item, `${path}[${index}]`));
    return;
  }
  for (const [key, nested] of Object.entries(value)) {
    if (FORBIDDEN_FIELD_NAME_PATTERN.test(key)) {
      proposalError(
        `Nimi proposal intake record carries a forbidden execution field: ${path}.${key}.`,
        'SDK_PROPOSAL_INTAKE_EXECUTION_FIELD_FORBIDDEN',
        'remove_execution_fields_from_proposal',
      );
    }
    assertNoForbiddenRecordFields(nested, `${path}.${key}`);
  }
}

function normalizeDraft(input: NimiProposalIntakeDraft): NimiProposalIntakeDraft {
  assertNoForbiddenRecordFields(input, 'draft');
  const draft = {
    proposalKind: normalizeProposalKind(input.proposalKind),
    sourceConversationAnchorId: requireText(input.sourceConversationAnchorId, 'source_conversation_anchor_id'),
    requesterSubjectRef: requireText(input.requesterSubjectRef, 'requester_subject_ref'),
    ownerDomain: requireText(input.ownerDomain, 'owner_domain'),
    requestedCapabilityRef: requireText(input.requestedCapabilityRef, 'requested_capability_ref'),
    riskTier: normalizeRiskTier(input.riskTier),
    requiredPermissionRefs: normalizeStringList(input.requiredPermissionRefs, 'required_permission_refs'),
    nextReviewStep: requireText(input.nextReviewStep, 'next_review_step'),
    reasonCode: normalizeText(input.reasonCode) || undefined,
  };
  assertRetiredAliasBoundary(draft);
  if (draft.proposalKind === 'rejected_request' && !draft.reasonCode) {
    proposalError(
      'Nimi proposal intake rejected_request requires reason_code.',
      'SDK_PROPOSAL_INTAKE_INPUT_INVALID',
      'provide_rejection_reason_code',
    );
  }
  return draft;
}

function normalizeRecord(input: NimiProposalIntakeRecord): NimiProposalIntakeRecord {
  assertNoForbiddenRecordFields(input, 'proposal');
  const record = {
    proposalId: requireText(input.proposalId, 'proposal_id'),
    proposalKind: normalizeProposalKind(input.proposalKind),
    sourceConversationAnchorId: requireText(input.sourceConversationAnchorId, 'source_conversation_anchor_id'),
    requesterSubjectRef: requireText(input.requesterSubjectRef, 'requester_subject_ref'),
    ownerDomain: requireText(input.ownerDomain, 'owner_domain'),
    requestedCapabilityRef: requireText(input.requestedCapabilityRef, 'requested_capability_ref'),
    riskTier: normalizeRiskTier(input.riskTier),
    requiredPermissionRefs: normalizeStringList(input.requiredPermissionRefs, 'required_permission_refs'),
    nextReviewStep: requireText(input.nextReviewStep, 'next_review_step'),
    state: normalizeProposalState(input.state),
    reasonCode: requireText(input.reasonCode, 'reason_code'),
    auditRef: requireText(input.auditRef, 'audit_ref'),
    createdAt: requireText(input.createdAt, 'created_at'),
  };
  assertRetiredAliasBoundary(record);
  return record;
}

function requireOperation<T>(operation: T | undefined, operationName: string): T {
  if (!operation) {
    proposalError(
      `Nimi proposal intake requires Platform operation ${operationName}.`,
      'SDK_PROPOSAL_INTAKE_OPERATION_UNAVAILABLE',
      `connect_platform_${operationName}`,
    );
  }
  return operation;
}

export function buildNimiCapabilityProposalDraft(
  input: NimiCapabilityProposalDraftInput,
): NimiProposalIntakeDraft {
  return normalizeDraft({
    proposalKind: 'capability_proposal',
    sourceConversationAnchorId: input.sourceConversationAnchorId,
    requesterSubjectRef: input.requesterSubjectRef,
    ownerDomain: normalizeText(input.ownerDomain) || 'Platform',
    requestedCapabilityRef: input.requestedCapabilityRef,
    riskTier: input.riskTier ?? 'medium',
    requiredPermissionRefs: input.requiredPermissionRefs,
    nextReviewStep: normalizeText(input.nextReviewStep) || 'platform_review_capability_proposal',
    reasonCode: normalizeText(input.reasonCode) || undefined,
  });
}

// @nimi-authority: definition.nimi.sdks.feature-clients.proposal-plane
// @nimi-authority: rule.nimi.sdks.feature-clients.r053
// @nimi-authority: rule.nimi.sdks.feature-clients.r054
// @nimi-authority: rule.nimi.sdks.feature-clients.r056
export function createNimiProposalIntakeClient(
  options: NimiProposalIntakeClientOptions,
): NimiProposalIntakeClient {
  return {
    async create(draft) {
      const normalizedDraft = normalizeDraft(draft);
      const createProposal = requireOperation(options.createProposal, 'proposal_create');
      return normalizeRecord(await createProposal(normalizedDraft));
    },
    async get(proposalId) {
      const normalizedProposalId = requireText(proposalId, 'proposal_id');
      const getProposal = requireOperation(options.getProposal, 'proposal_get');
      const record = await getProposal(normalizedProposalId);
      return record ? normalizeRecord(record) : undefined;
    },
    async transition(transition) {
      const normalizedTransition = {
        proposalId: requireText(transition.proposalId, 'proposal_id'),
        toState: normalizeProposalState(transition.toState),
        reasonCode: requireText(transition.reasonCode, 'reason_code'),
        auditRef: normalizeText(transition.auditRef) || undefined,
      };
      const transitionProposal = requireOperation(options.transitionProposal, 'proposal_transition');
      return normalizeRecord(await transitionProposal(normalizedTransition));
    },
  };
}
