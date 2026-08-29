export type ZhiyuDelegationApprovalDecision = 'approve' | 'reject';

export type ZhiyuDelegationUxState =
  | 'blocked'
  | 'idle'
  | 'pending-approval'
  | 'denied'
  | 'firewall-blocked'
  | 'diagnostic';

export type ZhiyuDelegationCandidateState =
  | 'not_projected'
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'blocked';

export type ZhiyuDelegationPreviewState = 'not_projected' | 'ready' | 'blocked';

export type ZhiyuDelegationOutputFirewallState =
  | 'not_projected'
  | 'accepted'
  | 'approval-required'
  | 'quarantined'
  | 'rejected'
  | 'blocked';

export type ZhiyuDelegationRetryState = 'not_available' | 'retry_available';

export type ZhiyuDelegationApprovalState =
  | 'pending'
  | 'approved_once'
  | 'approved_for_session'
  | 'rejected'
  | 'expired'
  | 'policy_blocked'
  | 'unknown';

export type ZhiyuDelegationReplayStage = {
  readonly kind:
    | 'request'
    | 'gateway_evidence'
    | 'firewall_verdict'
    | 'approval_decision'
    | 'runtime_decision'
    | 'projection_disposition'
    | 'unknown';
  readonly stageId: string;
  readonly state: string;
  readonly reasonCode: string;
  readonly redactedSummary: string;
};

export type ZhiyuDelegationAuditState = {
  readonly state: 'not_projected' | 'approval-linked' | 'diagnostic-linked' | 'replay-linked';
  readonly decisionId: string | null;
  readonly approvalRequestId: string | null;
  readonly delegationRequestId: string | null;
  readonly policySnapshotId: string | null;
  readonly replayId: string | null;
  readonly replayOutcome:
    | 'reconstructed'
    | 'partial_redacted'
    | 'partial_missing_evidence'
    | 'blocked_by_policy'
    | 'invalid_lineage'
    | null;
  readonly projectionDisposition: string | null;
  readonly actionDisposition: string | null;
  readonly stageCount: number;
  readonly redacted: boolean;
  readonly stages: readonly ZhiyuDelegationReplayStage[];
};

export type ZhiyuDelegationScopeEvidence = {
  readonly requiredScopes: readonly string[];
  readonly grantedScopes: readonly string[];
  readonly admittedScopes: readonly string[];
  readonly evidenceState: 'required-only' | 'partial' | 'granted';
  readonly reasonCode: string;
};

export type ZhiyuDelegationUxStatus = {
  readonly transport: 'electron-ipc';
  readonly ready: boolean;
  readonly state: ZhiyuDelegationUxState;
  readonly reasonCode: string;
  readonly actionHint: string;
  readonly source: string;
  readonly message: string;
  readonly agentHandle: import('@nimiplatform/sdk/app').NimiLocalAppAgentHandle | null;
  readonly conversationAnchorId: string | null;
  readonly observedAt: string | null;
  readonly approvalMode: string | null;
  readonly providerCount: number;
  readonly pendingApprovalCount: number;
  readonly diagnosticCount: number;
  readonly candidateIntent: {
    readonly state: ZhiyuDelegationCandidateState;
    readonly approvalRequestId: string | null;
    readonly delegationRequestId: string | null;
    readonly providerProfileRef: string | null;
    readonly capabilityId: string | null;
    readonly toolName: string | null;
    readonly summaryRef: string | null;
    readonly policySnapshotId: string | null;
    readonly effectClass: string | null;
    readonly sensitivityClass: string | null;
    readonly reasonCode: string;
  };
  readonly preview: {
    readonly state: ZhiyuDelegationPreviewState;
    readonly summaryRef: string | null;
    readonly policySnapshotId: string | null;
    readonly effectClass: string | null;
    readonly sensitivityClass: string | null;
    readonly reasonCode: string;
  };
  readonly outputFirewall: {
    readonly state: ZhiyuDelegationOutputFirewallState;
    readonly diagnosticId: string | null;
    readonly gatewayEvidenceId: string | null;
    readonly firewallInputId: string | null;
    readonly firewallVerdict: string | null;
    readonly runtimeDecision: string | null;
    readonly reasonCode: string;
  };
  readonly audit: ZhiyuDelegationAuditState;
  readonly retryState: ZhiyuDelegationRetryState;
  readonly approvalItems: readonly {
    readonly approvalRequestId: string;
    readonly state: ZhiyuDelegationApprovalState;
    readonly providerProfileRef: string;
    readonly capabilityId: string;
    readonly toolName: string;
    readonly delegationRequestId: string;
    readonly turnId: string;
    readonly firewallVerdict: string;
    readonly reasonCode: string;
    readonly effectClass: string;
    readonly sensitivityClass: string;
    readonly summaryRef: string;
    readonly policySnapshotId: string;
  }[];
  readonly diagnosticItems: readonly {
    readonly diagnosticId: string;
    readonly providerProfileRef: string;
    readonly capabilityId: string;
    readonly toolName: string;
    readonly turnId: string;
    readonly gatewayEvidenceId: string;
    readonly firewallInputId: string;
    readonly firewallVerdict: string;
    readonly runtimeDecision: string;
    readonly reasonCode: string;
  }[];
  readonly lastDecision: {
    readonly state: 'none' | 'approved' | 'denied' | 'failed';
    readonly approvalRequestId: string | null;
    readonly reasonCode: string;
    readonly message: string;
  };
  readonly requiredScopes: readonly string[];
  readonly grantedScopes: readonly string[];
  readonly admittedScopes: readonly string[];
  readonly scopeEvidence: ZhiyuDelegationScopeEvidence;
  readonly unsupportedFields: readonly string[];
};

export function createInitialZhiyuDelegationEvidence(): ZhiyuDelegationUxStatus {
  return {
    transport: 'electron-ipc',
    ready: false,
    state: 'blocked',
    reasonCode: 'not-probed',
    actionHint: 'probe_runtime_delegation_control_surface',
    source: 'renderer',
    message: 'Runtime delegated control surface has not been probed.',
    agentHandle: null,
    conversationAnchorId: null,
    observedAt: null,
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
    lastDecision: {
      state: 'none',
      approvalRequestId: null,
      reasonCode: 'no-delegation-decision-submitted',
      message: 'No delegated approval decision has been submitted from Zhiyu.',
    },
    requiredScopes: [
      'runtime.agent.delegation.read',
      'runtime.agent.delegation.write',
    ],
    grantedScopes: [],
    admittedScopes: [],
    scopeEvidence: {
      requiredScopes: [
        'runtime.agent.delegation.read',
        'runtime.agent.delegation.write',
      ],
      grantedScopes: [],
      admittedScopes: [],
      evidenceState: 'required-only',
      reasonCode: 'runtime-delegation-scope-grant-not-projected',
    },
    unsupportedFields: ['runtime_delegation_control_surface'],
  };
}
