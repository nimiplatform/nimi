import type {
  ZhiyuDelegationApprovalDecision,
  ZhiyuDelegationUxStatus,
} from '../app/evidence';

export const APP_ID = 'nimi.zhiyu';
export const DELEGATION_READ_SCOPE = 'runtime.agent.delegation.read';
export const DELEGATION_WRITE_SCOPE = 'runtime.agent.delegation.write';

export type DelegationIdentity = {
  readonly ownerUserId: string;
  readonly runtimeSourceRef: string;
  readonly localAgentRef: string;
  readonly conversationAnchorId: string;
};

export type DelegationSnapshotQuery = DelegationIdentity;

export type DelegationApprovalRequest = {
  readonly approvalRequestId?: string;
  readonly agentId?: string;
  readonly conversationAnchorId?: string;
  readonly turnId?: string;
  readonly providerProfileId?: string;
  readonly capabilityId?: string;
  readonly toolName?: string;
  readonly firewallVerdict?: string;
  readonly reasonCode?: string;
  readonly state?: unknown;
  readonly delegationRequestId?: string;
  readonly effectClass?: unknown;
  readonly sensitivityClass?: unknown;
  readonly summaryRef?: string;
  readonly policySnapshotId?: string;
};

export type DelegationDiagnostic = {
  readonly diagnosticId?: string;
  readonly agentId?: string;
  readonly conversationAnchorId?: string;
  readonly turnId?: string;
  readonly providerProfileId?: string;
  readonly capabilityId?: string;
  readonly toolName?: string;
  readonly gatewayEvidenceId?: string;
  readonly firewallInputId?: string;
  readonly firewallVerdict?: string;
  readonly runtimeDecision?: string;
  readonly reasonCode?: string;
};

export type DelegationReplayTrace = {
  readonly replayId?: string;
  readonly replay_id?: string;
  readonly outcome?: unknown;
  readonly stages?: readonly DelegationReplayTraceStageInput[];
  readonly projectionDisposition?: string;
  readonly projection_disposition?: string;
  readonly actionDisposition?: string;
  readonly action_disposition?: string;
  readonly redacted?: boolean;
};

export type DelegationReplayTraceStageInput = {
  readonly kind?: unknown;
  readonly stageId?: string;
  readonly stage_id?: string;
  readonly state?: string;
  readonly reasonCode?: string;
  readonly reason_code?: string;
  readonly redactedSummary?: string;
  readonly redacted_summary?: string;
};

export type DelegationControlSurfaceSnapshot = {
  readonly agentId?: string;
  readonly conversationAnchorId?: string;
  readonly approvalMode?: unknown;
  readonly providerProfiles?: readonly unknown[];
  readonly approvalRequests?: readonly DelegationApprovalRequest[];
  readonly diagnostics?: readonly DelegationDiagnostic[];
  readonly requiredScopes?: readonly unknown[];
  readonly grantedScopes?: readonly unknown[];
  readonly admittedScopes?: readonly unknown[];
  readonly observedAt?: unknown;
};

export type ZhiyuDelegationSnapshotReader = (
  input: DelegationSnapshotQuery,
) => Promise<DelegationControlSurfaceSnapshot | null | undefined>;

export type ZhiyuDelegationApprovalSubmitter = (
  input: DelegationIdentity & {
    readonly approvalRequestId: string;
    readonly decision: ZhiyuDelegationApprovalDecision;
    readonly decisionReason: string;
  },
) => Promise<{ readonly approvalRequest?: DelegationApprovalRequest | null } | void>;

export type ZhiyuDelegationReplayLoader = (
  input: DelegationIdentity & {
    readonly decisionId: string;
    readonly turnId?: string;
  },
) => Promise<DelegationReplayTrace | null | undefined>;

export interface ZhiyuDelegationUxProbeOptions {
  readonly observedAt?: string;
  readonly loadSnapshot?: ZhiyuDelegationSnapshotReader;
  readonly submitApprovalDecision?: ZhiyuDelegationApprovalSubmitter;
  readonly loadReplayTrace?: ZhiyuDelegationReplayLoader;
}

export type DelegationControlSurface = {
  readonly loadSnapshot: ZhiyuDelegationSnapshotReader;
  readonly submitApprovalDecision: ZhiyuDelegationApprovalSubmitter;
  readonly loadReplayTrace: ZhiyuDelegationReplayLoader;
};

export type DelegationUnavailableInput = {
  readonly reasonCode: string;
  readonly actionHint: string;
  readonly source: string;
  readonly message: string;
  readonly ownerUserId?: string | null;
  readonly runtimeSourceRef?: string | null;
  readonly localAgentRef?: string | null;
  readonly conversationAnchorId?: string | null;
  readonly observedAt?: string | null;
  readonly lastDecision?: ZhiyuDelegationUxStatus['lastDecision'];
};
