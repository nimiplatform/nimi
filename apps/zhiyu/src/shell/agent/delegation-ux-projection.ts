import type {
  ZhiyuDelegationAuditState,
  ZhiyuDelegationCandidateState,
  ZhiyuDelegationOutputFirewallState,
  ZhiyuDelegationPreviewState,
  ZhiyuDelegationReplayStage,
  ZhiyuDelegationUxStatus,
} from '../app/evidence';
import type { ZhiyuConversationHomeStatus } from './conversation-home';
import { requiredOnlyScopeEvidence, scopeEvidenceFromSnapshot } from './delegation-scope-evidence';
import {
  type DelegationControlSurfaceSnapshot,
  type DelegationDiagnostic,
  type DelegationIdentity,
  type DelegationReplayTrace,
  type DelegationUnavailableInput,
  type ZhiyuDelegationReplayLoader,
} from './delegation-ux-types';

export async function loadReplayTraceOrNull(
  surface: {
    readonly loadReplayTrace: ZhiyuDelegationReplayLoader;
  },
  identity: DelegationIdentity,
  diagnostic: DelegationDiagnostic,
): Promise<DelegationReplayTrace | null> {
  const decisionId = stringOr(diagnostic.diagnosticId, '');
  if (!decisionId) {
    return null;
  }
  try {
    return await surface.loadReplayTrace({
      ...identity,
      decisionId,
      turnId: stringOr(diagnostic.turnId, ''),
    }) ?? null;
  } catch {
    return null;
  }
}

export function projectDelegationStatus(input: {
  readonly identity: DelegationIdentity;
  readonly snapshot: DelegationControlSurfaceSnapshot | null | undefined;
  readonly replayTrace: DelegationReplayTrace | null;
  readonly observedAt?: string;
}): ZhiyuDelegationUxStatus {
  const snapshot = input.snapshot ?? {};
  const approvals = (snapshot.approvalRequests ?? []).map(projectApprovalItem);
  const diagnostics = (snapshot.diagnostics ?? []).map(projectDiagnosticItem);
  const primaryApproval = approvals.find((approval) => approval.state === 'pending') ?? approvals[0] ?? null;
  const diagnostic = diagnostics[0] ?? null;
  const candidateIntent = candidateIntentFromApproval(primaryApproval);
  const preview = previewFromApproval(primaryApproval);
  const outputFirewall = diagnostic
    ? outputFirewallFromDiagnostic(diagnostic)
    : outputFirewallFromApproval(primaryApproval);
  const audit = auditFromProjection(primaryApproval, diagnostic, input.replayTrace);
  const providerCount = Array.isArray(snapshot.providerProfiles) ? snapshot.providerProfiles.length : 0;
  const pendingApprovalCount = approvals.filter((approval) => approval.state === 'pending').length;
  const state = stateFromProjection(candidateIntent, outputFirewall, diagnostics.length, providerCount);
  const reasonCode = reasonCodeFromState(state, primaryApproval, diagnostic);
  const scopeEvidence = scopeEvidenceFromSnapshot(snapshot);
  return {
    transport: 'electron-ipc',
    ready: true,
    state,
    reasonCode,
    actionHint: actionHintFromState(state),
    source: 'runtime',
    message: messageFromState(state),
    ...input.identity,
    observedAt: timestampOrText(snapshot.observedAt) ?? stringOr(input.observedAt, null),
    approvalMode: approvalModeLabel(snapshot.approvalMode),
    providerCount,
    pendingApprovalCount,
    diagnosticCount: diagnostics.length,
    candidateIntent,
    preview,
    outputFirewall,
    audit,
    retryState: state === 'denied' || state === 'firewall-blocked' ? 'retry_available' : 'not_available',
    approvalItems: approvals,
    diagnosticItems: diagnostics,
    lastDecision: {
      state: 'none',
      approvalRequestId: null,
      reasonCode: 'no-delegation-decision-submitted',
      message: 'No delegated approval decision has been submitted from Zhiyu.',
    },
    requiredScopes: scopeEvidence.requiredScopes,
    grantedScopes: scopeEvidence.grantedScopes,
    admittedScopes: scopeEvidence.admittedScopes,
    scopeEvidence,
    unsupportedFields: [],
  };
}

function projectApprovalItem(approval: {
  readonly approvalRequestId?: string;
  readonly providerProfileId?: string;
  readonly capabilityId?: string;
  readonly toolName?: string;
  readonly turnId?: string;
  readonly firewallVerdict?: string;
  readonly reasonCode?: string;
  readonly state?: unknown;
  readonly delegationRequestId?: string;
  readonly effectClass?: unknown;
  readonly sensitivityClass?: unknown;
  readonly summaryRef?: string;
  readonly policySnapshotId?: string;
}): ZhiyuDelegationUxStatus['approvalItems'][number] {
  return {
    approvalRequestId: stringOr(approval.approvalRequestId, 'not_projected'),
    state: approvalStateLabel(approval.state),
    providerProfileRef: stringOr(approval.providerProfileId, 'not_projected'),
    capabilityId: stringOr(approval.capabilityId, 'not_projected'),
    toolName: stringOr(approval.toolName, 'not_projected'),
    delegationRequestId: stringOr(approval.delegationRequestId, 'not_projected'),
    turnId: stringOr(approval.turnId, 'not_projected'),
    firewallVerdict: normalizeToken(approval.firewallVerdict, 'not_projected'),
    reasonCode: stringOr(approval.reasonCode, 'not_projected'),
    effectClass: effectClassLabel(approval.effectClass),
    sensitivityClass: sensitivityClassLabel(approval.sensitivityClass),
    summaryRef: stringOr(approval.summaryRef, 'not_projected'),
    policySnapshotId: stringOr(approval.policySnapshotId, 'not_projected'),
  };
}

function projectDiagnosticItem(diagnostic: DelegationDiagnostic): ZhiyuDelegationUxStatus['diagnosticItems'][number] {
  return {
    diagnosticId: stringOr(diagnostic.diagnosticId, 'not_projected'),
    providerProfileRef: stringOr(diagnostic.providerProfileId, 'not_projected'),
    capabilityId: stringOr(diagnostic.capabilityId, 'not_projected'),
    toolName: stringOr(diagnostic.toolName, 'not_projected'),
    turnId: stringOr(diagnostic.turnId, 'not_projected'),
    gatewayEvidenceId: stringOr(diagnostic.gatewayEvidenceId, 'not_projected'),
    firewallInputId: stringOr(diagnostic.firewallInputId, 'not_projected'),
    firewallVerdict: normalizeToken(diagnostic.firewallVerdict, 'not_projected'),
    runtimeDecision: normalizeToken(diagnostic.runtimeDecision, 'not_projected'),
    reasonCode: stringOr(diagnostic.reasonCode, 'not_projected'),
  };
}

function candidateIntentFromApproval(
  approval: ZhiyuDelegationUxStatus['approvalItems'][number] | null,
): ZhiyuDelegationUxStatus['candidateIntent'] {
  if (!approval) {
    return {
      state: 'not_projected',
      approvalRequestId: null,
      delegationRequestId: null,
      providerProfileRef: null,
      capabilityId: null,
      toolName: null,
      summaryRef: null,
      policySnapshotId: null,
      effectClass: null,
      sensitivityClass: null,
      reasonCode: 'runtime-delegation-candidate-not-projected',
    };
  }
  return {
    state: candidateStateFromApproval(approval.state),
    approvalRequestId: approval.approvalRequestId,
    delegationRequestId: approval.delegationRequestId,
    providerProfileRef: approval.providerProfileRef,
    capabilityId: approval.capabilityId,
    toolName: approval.toolName,
    summaryRef: approval.summaryRef,
    policySnapshotId: approval.policySnapshotId,
    effectClass: approval.effectClass,
    sensitivityClass: approval.sensitivityClass,
    reasonCode: approval.reasonCode,
  };
}

function previewFromApproval(
  approval: ZhiyuDelegationUxStatus['approvalItems'][number] | null,
): ZhiyuDelegationUxStatus['preview'] {
  if (!approval) {
    return {
      state: 'not_projected',
      summaryRef: null,
      policySnapshotId: null,
      effectClass: null,
      sensitivityClass: null,
      reasonCode: 'runtime-delegation-preview-not-projected',
    };
  }
  return {
    state: approval.state === 'pending' || approval.state.startsWith('approved') ? 'ready' : 'blocked',
    summaryRef: approval.summaryRef,
    policySnapshotId: approval.policySnapshotId,
    effectClass: approval.effectClass,
    sensitivityClass: approval.sensitivityClass,
    reasonCode: approval.reasonCode,
  };
}

function outputFirewallFromApproval(
  approval: ZhiyuDelegationUxStatus['approvalItems'][number] | null,
): ZhiyuDelegationUxStatus['outputFirewall'] {
  if (!approval) {
    return {
      state: 'not_projected',
      diagnosticId: null,
      gatewayEvidenceId: null,
      firewallInputId: null,
      firewallVerdict: null,
      runtimeDecision: null,
      reasonCode: 'runtime-delegation-firewall-not-projected',
    };
  }
  return {
    state: outputFirewallStateFromVerdict(approval.firewallVerdict),
    diagnosticId: null,
    gatewayEvidenceId: null,
    firewallInputId: null,
    firewallVerdict: approval.firewallVerdict,
    runtimeDecision: approval.state,
    reasonCode: approval.reasonCode,
  };
}

export function outputFirewallFromDiagnostic(
  diagnostic: ZhiyuDelegationUxStatus['diagnosticItems'][number] | DelegationDiagnostic,
): ZhiyuDelegationUxStatus['outputFirewall'] {
  const item = 'diagnosticId' in diagnostic && 'gatewayEvidenceId' in diagnostic
    ? diagnostic as ZhiyuDelegationUxStatus['diagnosticItems'][number]
    : projectDiagnosticItem(diagnostic as DelegationDiagnostic);
  return {
    state: outputFirewallStateFromVerdict(item.firewallVerdict),
    diagnosticId: item.diagnosticId,
    gatewayEvidenceId: item.gatewayEvidenceId,
    firewallInputId: item.firewallInputId,
    firewallVerdict: item.firewallVerdict,
    runtimeDecision: item.runtimeDecision,
    reasonCode: item.reasonCode,
  };
}

function auditFromProjection(
  approval: ZhiyuDelegationUxStatus['approvalItems'][number] | null,
  diagnostic: ZhiyuDelegationUxStatus['diagnosticItems'][number] | null,
  replayTrace: DelegationReplayTrace | null,
): ZhiyuDelegationUxStatus['audit'] {
  if (diagnostic && replayTrace) {
    const stages = replayStages(replayTrace);
    return {
      state: 'replay-linked',
      decisionId: diagnostic.diagnosticId,
      approvalRequestId: approval?.approvalRequestId ?? null,
      delegationRequestId: approval?.delegationRequestId ?? null,
      policySnapshotId: approval?.policySnapshotId ?? null,
      replayId: stringOr(replayTrace.replayId, null) ?? stringOr(replayTrace.replay_id, null),
      replayOutcome: replayOutcomeLabel(replayTrace.outcome),
      projectionDisposition: stringOr(replayTrace.projectionDisposition, null)
        ?? stringOr(replayTrace.projection_disposition, null),
      actionDisposition: stringOr(replayTrace.actionDisposition, null)
        ?? stringOr(replayTrace.action_disposition, null),
      stageCount: stages.length,
      redacted: replayTrace.redacted === true,
      stages,
    };
  }
  if (diagnostic) {
    return {
      state: 'diagnostic-linked',
      decisionId: diagnostic.diagnosticId,
      approvalRequestId: approval?.approvalRequestId ?? null,
      delegationRequestId: approval?.delegationRequestId ?? null,
      policySnapshotId: approval?.policySnapshotId ?? null,
      replayId: null,
      replayOutcome: null,
      projectionDisposition: null,
      actionDisposition: null,
      stageCount: 0,
      redacted: true,
      stages: [],
    };
  }
  if (approval) {
    return {
      state: 'approval-linked',
      decisionId: null,
      approvalRequestId: approval.approvalRequestId,
      delegationRequestId: approval.delegationRequestId,
      policySnapshotId: approval.policySnapshotId,
      replayId: null,
      replayOutcome: null,
      projectionDisposition: null,
      actionDisposition: null,
      stageCount: 0,
      redacted: true,
      stages: [],
    };
  }
  return {
    state: 'not_projected',
    decisionId: null,
    approvalRequestId: null,
    delegationRequestId: null,
    policySnapshotId: null,
    replayId: null,
    replayOutcome: null,
    projectionDisposition: null,
    actionDisposition: null,
    stageCount: 0,
    redacted: true,
    stages: [],
  };
}

function replayStages(trace: DelegationReplayTrace): readonly ZhiyuDelegationReplayStage[] {
  return (trace.stages ?? []).map((stage) => ({
    kind: replayStageKindLabel(stage.kind),
    stageId: stringOr(stage.stageId, stringOr(stage.stage_id, 'not_projected')),
    state: normalizeToken(stage.state, 'not_projected'),
    reasonCode: stringOr(stage.reasonCode, stringOr(stage.reason_code, 'not_projected')),
    redactedSummary: stringOr(stage.redactedSummary, stringOr(stage.redacted_summary, '')),
  }));
}

export function stateFromProjection(
  candidate: ZhiyuDelegationUxStatus['candidateIntent'],
  firewall: ZhiyuDelegationUxStatus['outputFirewall'],
  diagnosticCount: number,
  providerCount: number,
): ZhiyuDelegationUxStatus['state'] {
  if (firewall.state === 'blocked' || firewall.state === 'quarantined' || firewall.state === 'rejected') {
    return 'firewall-blocked';
  }
  if (candidate.state === 'pending') {
    return 'pending-approval';
  }
  if (candidate.state === 'rejected') {
    return 'denied';
  }
  if (diagnosticCount > 0) {
    return 'diagnostic';
  }
  if (providerCount > 0) {
    return 'idle';
  }
  return 'idle';
}

function reasonCodeFromState(
  state: ZhiyuDelegationUxStatus['state'],
  approval: ZhiyuDelegationUxStatus['approvalItems'][number] | null,
  diagnostic: ZhiyuDelegationUxStatus['diagnosticItems'][number] | null,
): string {
  switch (state) {
    case 'pending-approval':
      return 'runtime-delegation-approval-pending';
    case 'denied':
      return 'runtime-delegation-approval-denied';
    case 'firewall-blocked':
      return stringOr(diagnostic?.reasonCode, stringOr(approval?.reasonCode, 'runtime-delegation-firewall-blocked'));
    case 'diagnostic':
      return stringOr(diagnostic?.reasonCode, 'runtime-delegation-diagnostic-projected');
    case 'idle':
      return 'runtime-delegation-control-surface-ready';
    case 'blocked':
      return 'runtime-delegation-control-surface-blocked';
  }
}

function actionHintFromState(state: ZhiyuDelegationUxStatus['state']): string {
  switch (state) {
    case 'pending-approval':
      return 'review_runtime_delegation_approval';
    case 'denied':
      return 'inspect_runtime_delegation_rejection';
    case 'firewall-blocked':
      return 'inspect_runtime_delegation_firewall_replay';
    case 'diagnostic':
      return 'inspect_runtime_delegation_audit_replay';
    case 'idle':
      return 'wait_for_runtime_delegation_candidate';
    case 'blocked':
      return 'repair_runtime_delegation_control_surface';
  }
}

function messageFromState(state: ZhiyuDelegationUxStatus['state']): string {
  switch (state) {
    case 'pending-approval':
      return 'Runtime has a delegated approval request ready for user review.';
    case 'denied':
      return 'Runtime recorded a delegated approval rejection.';
    case 'firewall-blocked':
      return 'Runtime delegated output firewall blocked or quarantined the provider output.';
    case 'diagnostic':
      return 'Runtime delegated diagnostic and audit evidence are projected.';
    case 'idle':
      return 'Runtime delegated control surface is readable and waiting for a candidate.';
    case 'blocked':
      return 'Runtime delegated control surface is unavailable.';
  }
}

export function normalizeDelegationError(
  error: unknown,
  identity: DelegationIdentity,
  observedAt?: string,
): ZhiyuDelegationUxStatus {
  const record = error && typeof error === 'object' ? error as Record<string, unknown> : {};
  return delegationUnavailable({
    reasonCode: stringOr(record.reasonCode, 'zhiyu-delegation-control-surface-unavailable'),
    actionHint: stringOr(record.actionHint, 'check_runtime_delegation_control_surface'),
    source: stringOr(record.source, 'sdk'),
    message: error instanceof Error && error.message.trim()
      ? error.message.trim()
      : 'Runtime delegated control surface is unavailable.',
    ...identity,
    observedAt,
  });
}

export function delegationUnavailable(input: DelegationUnavailableInput): ZhiyuDelegationUxStatus {
  const scopeEvidence = requiredOnlyScopeEvidence();
  return {
    transport: 'electron-ipc',
    ready: false,
    state: 'blocked',
    reasonCode: input.reasonCode,
    actionHint: input.actionHint,
    source: input.source,
    message: input.message,
    agentHandle: input.agentHandle ?? null,
    conversationAnchorId: input.conversationAnchorId ?? null,
    observedAt: input.observedAt ?? null,
    approvalMode: null,
    providerCount: 0,
    pendingApprovalCount: 0,
    diagnosticCount: 0,
    candidateIntent: {
      state: 'not_projected',
      approvalRequestId: null,
      delegationRequestId: null,
      providerProfileRef: null,
      capabilityId: null,
      toolName: null,
      summaryRef: null,
      policySnapshotId: null,
      effectClass: null,
      sensitivityClass: null,
      reasonCode: 'runtime-delegation-candidate-not-projected',
    },
    preview: {
      state: 'not_projected',
      summaryRef: null,
      policySnapshotId: null,
      effectClass: null,
      sensitivityClass: null,
      reasonCode: 'runtime-delegation-preview-not-projected',
    },
    outputFirewall: {
      state: 'not_projected',
      diagnosticId: null,
      gatewayEvidenceId: null,
      firewallInputId: null,
      firewallVerdict: null,
      runtimeDecision: null,
      reasonCode: 'runtime-delegation-firewall-not-projected',
    },
    audit: {
      state: 'not_projected',
      decisionId: null,
      approvalRequestId: null,
      delegationRequestId: null,
      policySnapshotId: null,
      replayId: null,
      replayOutcome: null,
      projectionDisposition: null,
      actionDisposition: null,
      stageCount: 0,
      redacted: true,
      stages: [],
    },
    retryState: 'not_available',
    approvalItems: [],
    diagnosticItems: [],
    lastDecision: input.lastDecision ?? {
      state: 'none',
      approvalRequestId: null,
      reasonCode: 'no-delegation-decision-submitted',
      message: 'No delegated approval decision has been submitted from Zhiyu.',
    },
    requiredScopes: scopeEvidence.requiredScopes,
    grantedScopes: scopeEvidence.grantedScopes,
    admittedScopes: scopeEvidence.admittedScopes,
    scopeEvidence,
    unsupportedFields: ['runtime_delegation_control_surface'],
  };
}

export function conversationIdentity(conversation: ZhiyuConversationHomeStatus): DelegationIdentity | null {
  if (!conversation.ready) {
    return null;
  }
  const agentHandle = conversation.agentHandle;
  const conversationAnchorId = stringOr(conversation.conversationAnchorId, '');
  if (!agentHandle || !conversationAnchorId) {
    return null;
  }
  return {
    agentHandle,
    conversationAnchorId,
  };
}

export function primaryDiagnostic(snapshot: DelegationControlSurfaceSnapshot | null | undefined): DelegationDiagnostic | null {
  return snapshot?.diagnostics?.[0] ?? null;
}

function approvalStateLabel(value: unknown): ZhiyuDelegationUxStatus['approvalItems'][number]['state'] {
  const normalized = normalizeToken(value, '');
  switch (normalized) {
    case '1':
    case 'pending':
    case 'delegated_approval_request_state_pending':
      return 'pending';
    case '2':
    case 'approved_once':
    case 'delegated_approval_request_state_approved_once':
      return 'approved_once';
    case '3':
    case 'rejected':
    case 'delegated_approval_request_state_rejected':
      return 'rejected';
    case '4':
    case 'expired':
    case 'delegated_approval_request_state_expired':
      return 'expired';
    case '5':
    case 'approved_for_session':
    case 'delegated_approval_request_state_approved_for_session':
      return 'approved_for_session';
    case '6':
    case 'policy_blocked':
    case 'delegated_approval_request_state_policy_blocked':
      return 'policy_blocked';
    default:
      return 'unknown';
  }
}

function candidateStateFromApproval(
  state: ZhiyuDelegationUxStatus['approvalItems'][number]['state'],
): ZhiyuDelegationCandidateState {
  switch (state) {
    case 'pending':
      return 'pending';
    case 'approved_once':
    case 'approved_for_session':
      return 'approved';
    case 'rejected':
      return 'rejected';
    case 'expired':
    case 'policy_blocked':
      return 'blocked';
    case 'unknown':
    default:
      return 'not_projected';
  }
}

function outputFirewallStateFromVerdict(value: unknown): ZhiyuDelegationOutputFirewallState {
  const verdict = normalizeToken(value, '');
  switch (verdict) {
    case 'accepted_observation':
    case 'accepted_suggestion':
      return 'accepted';
    case 'approval_required':
      return 'approval-required';
    case 'quarantined':
      return 'quarantined';
    case 'rejected':
      return 'rejected';
    case 'policy_blocked':
    case 'provider_drifted':
    case 'schema_invalid':
      return 'blocked';
    default:
      return 'not_projected';
  }
}

function approvalModeLabel(value: unknown): string | null {
  const normalized = normalizeToken(value, '');
  switch (normalized) {
    case '1':
    case 'runtime_policy':
    case 'delegated_approval_mode_runtime_policy':
      return 'runtime_policy';
    case '2':
    case 'require_user':
    case 'delegated_approval_mode_require_user':
      return 'require_user';
    case '3':
    case 'disabled':
    case 'delegated_approval_mode_disabled':
      return 'disabled';
    default:
      return null;
  }
}

function effectClassLabel(value: unknown): string {
  const normalized = normalizeToken(value, '');
  switch (normalized) {
    case '1':
    case 'read_only':
    case 'effect_class_read_only':
      return 'read_only';
    case '2':
    case 'local_side_effect':
    case 'effect_class_local_side_effect':
      return 'local_side_effect';
    case '3':
    case 'external_side_effect':
    case 'effect_class_external_side_effect':
      return 'external_side_effect';
    case '4':
    case 'sensitive_read':
    case 'effect_class_sensitive_read':
      return 'sensitive_read';
    case '5':
    case 'unsupported_effect':
    case 'effect_class_unsupported_effect':
      return 'unsupported_effect';
    default:
      return 'not_projected';
  }
}

function sensitivityClassLabel(value: unknown): string {
  const normalized = normalizeToken(value, '');
  switch (normalized) {
    case '1':
    case 'none':
    case 'sensitivity_class_none':
      return 'none';
    case '2':
    case 'user_private':
    case 'sensitivity_class_user_private':
      return 'user_private';
    case '3':
    case 'credential_like':
    case 'sensitivity_class_credential_like':
      return 'credential_like';
    case '4':
    case 'org_private':
    case 'sensitivity_class_org_private':
      return 'org_private';
    case '5':
    case 'regulated':
    case 'sensitivity_class_regulated':
      return 'regulated';
    case '6':
    case 'unknown_sensitive':
    case 'sensitivity_class_unknown_sensitive':
      return 'unknown_sensitive';
    default:
      return 'not_projected';
  }
}

function replayOutcomeLabel(value: unknown): ZhiyuDelegationAuditState['replayOutcome'] {
  const normalized = normalizeToken(value, '');
  switch (normalized) {
    case '1':
    case 'reconstructed':
    case 'delegated_replay_outcome_reconstructed':
      return 'reconstructed';
    case '2':
    case 'partial_redacted':
    case 'delegated_replay_outcome_partial_redacted':
      return 'partial_redacted';
    case '3':
    case 'partial_missing_evidence':
    case 'delegated_replay_outcome_partial_missing_evidence':
      return 'partial_missing_evidence';
    case '4':
    case 'blocked_by_policy':
    case 'delegated_replay_outcome_blocked_by_policy':
      return 'blocked_by_policy';
    case '5':
    case 'invalid_lineage':
    case 'delegated_replay_outcome_invalid_lineage':
      return 'invalid_lineage';
    default:
      return null;
  }
}

function replayStageKindLabel(value: unknown): ZhiyuDelegationReplayStage['kind'] {
  const normalized = normalizeToken(value, '');
  switch (normalized) {
    case '1':
    case 'request':
    case 'delegated_trace_stage_kind_request':
      return 'request';
    case '2':
    case 'gateway_evidence':
    case 'delegated_trace_stage_kind_gateway_evidence':
      return 'gateway_evidence';
    case '3':
    case 'firewall_verdict':
    case 'delegated_trace_stage_kind_firewall_verdict':
      return 'firewall_verdict';
    case '4':
    case 'approval_decision':
    case 'delegated_trace_stage_kind_approval_decision':
      return 'approval_decision';
    case '5':
    case 'runtime_decision':
    case 'delegated_trace_stage_kind_runtime_decision':
      return 'runtime_decision';
    case '6':
    case 'projection_disposition':
    case 'delegated_trace_stage_kind_projection_disposition':
      return 'projection_disposition';
    default:
      return 'unknown';
  }
}

function normalizeToken(value: unknown, fallback: string): string {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  if (typeof value !== 'string') {
    return fallback;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return fallback;
  }
  return trimmed
    .replace(/^DELEGATED_APPROVAL_REQUEST_STATE_/u, '')
    .replace(/^DELEGATED_APPROVAL_MODE_/u, '')
    .replace(/^DELEGATED_REPLAY_OUTCOME_/u, '')
    .replace(/^DELEGATED_TRACE_STAGE_KIND_/u, '')
    .replace(/^EFFECT_CLASS_/u, '')
    .replace(/^SENSITIVITY_CLASS_/u, '')
    .toLowerCase()
    .replace(/-/gu, '_');
}

function timestampOrText(value: unknown): string | null {
  const text = stringOr(value, null);
  if (text) {
    return text;
  }
  if (!value || typeof value !== 'object') {
    return null;
  }
  const record = value as {
    readonly seconds?: number | bigint | string;
    readonly nanos?: number;
    readonly toDate?: () => Date;
  };
  if (typeof record.toDate === 'function') {
    const date = record.toDate();
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  if (record.seconds === undefined) {
    return null;
  }
  const seconds = typeof record.seconds === 'bigint'
    ? Number(record.seconds)
    : Number(record.seconds);
  if (!Number.isFinite(seconds)) {
    return null;
  }
  const millis = (seconds * 1000) + Math.floor((record.nanos ?? 0) / 1_000_000);
  const date = new Date(millis);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function stringOr(value: unknown, fallback: string): string;
export function stringOr(value: unknown, fallback: null): string | null;
export function stringOr(value: unknown, fallback: string | null): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}
