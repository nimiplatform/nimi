import {
  Button,
  StatusBadge,
  Surface,
} from '@nimiplatform/kit/ui';
import {
  CircleCheck,
  CircleX,
  Workflow,
} from 'lucide-react';
import type {
  ZhiyuDelegationApprovalDecision,
  ZhiyuDelegationUxState,
  ZhiyuEvidence,
} from './evidence';
import type { ZhiyuHomeGatedSurface } from './home-product-state';

export function DelegationUxSection({
  surface,
  delegation,
  onDecision,
}: {
  readonly surface: ZhiyuHomeGatedSurface;
  readonly delegation: ZhiyuEvidence['delegation'];
  readonly onDecision: (
    approvalRequestId: string,
    decision: ZhiyuDelegationApprovalDecision,
  ) => void;
}) {
  return (
    <Surface
      as="section"
      className="zhiyu-home__gated zhiyu-home__delegation-ux"
      data-zhiyu-region="delegation"
      data-zhiyu-gated-surface="delegation"
      data-zhiyu-delegation-ux={delegation.state}
      data-zhiyu-delegation-ready={String(delegation.ready)}
      data-zhiyu-delegation-reason={delegation.reasonCode}
      data-zhiyu-delegation-provider-count={String(delegation.providerCount)}
      data-zhiyu-delegation-pending-count={String(delegation.pendingApprovalCount)}
      data-zhiyu-delegation-diagnostic-count={String(delegation.diagnosticCount)}
      data-zhiyu-delegation-retry-state={delegation.retryState}
      data-zhiyu-delegation-candidate-state={delegation.candidateIntent.state}
      data-zhiyu-delegation-preview-state={delegation.preview.state}
      data-zhiyu-delegation-output-firewall-state={delegation.outputFirewall.state}
      data-zhiyu-delegation-audit-state={delegation.audit.state}
      data-zhiyu-delegation-audit-decision-id={delegation.audit.decisionId ?? 'not_projected'}
      material="glass-thin"
      elevation="base"
      padding="md"
    >
      <div className="zhiyu-home__section-heading">
        <Workflow size={18} aria-hidden="true" />
        <div>
          <h2>{surface.title}</h2>
          <p>{surface.description}</p>
        </div>
      </div>
      <div className="zhiyu-home__delegation-summary">
        <StatusBadge tone={toneForDelegationState(delegation.state)} shape="dot">
          {delegation.reasonCode}
        </StatusBadge>
        <span>{delegation.providerCount} providers</span>
        <span>{delegation.pendingApprovalCount} pending</span>
        <span>{delegation.diagnosticCount} diagnostics</span>
      </div>
      <div className="zhiyu-home__delegation-grid" aria-label="delegation control projection">
        <DelegationField label="candidate" value={delegation.candidateIntent.state} />
        <DelegationField label="preview" value={delegation.preview.state} />
        <DelegationField label="firewall" value={delegation.outputFirewall.state} />
        <DelegationField label="audit" value={delegation.audit.state} />
        <DelegationField label="summaryRef" value={delegation.preview.summaryRef} />
        <DelegationField label="policySnapshot" value={delegation.preview.policySnapshotId} />
      </div>
      <div className="zhiyu-home__delegation-approvals" aria-label="delegation approvals">
        {delegation.approvalItems.length > 0 ? delegation.approvalItems.map((approval) => (
          <div
            key={approval.approvalRequestId}
            className="zhiyu-home__delegation-approval"
            data-zhiyu-delegation-approval={approval.approvalRequestId}
            data-zhiyu-delegation-approval-state={approval.state}
            data-zhiyu-delegation-approval-summary-ref={approval.summaryRef}
            data-zhiyu-delegation-approval-policy-snapshot={approval.policySnapshotId}
            data-zhiyu-delegation-approval-effect-class={approval.effectClass}
            data-zhiyu-delegation-approval-sensitivity-class={approval.sensitivityClass}
            data-zhiyu-delegation-approval-firewall-verdict={approval.firewallVerdict}
          >
            <div>
              <strong>{approval.toolName}</strong>
              <small>{approval.capabilityId} / {approval.effectClass} / {approval.sensitivityClass}</small>
              <small>{approval.summaryRef}</small>
            </div>
            {approval.state === 'pending' ? (
              <div className="zhiyu-home__delegation-actions">
                <Button
                  type="button"
                  tone="danger"
                  size="sm"
                  leadingIcon={<CircleX size={15} aria-hidden="true" />}
                  onClick={() => onDecision(approval.approvalRequestId, 'reject')}
                >
                  Deny
                </Button>
                <Button
                  type="button"
                  tone="primary"
                  size="sm"
                  leadingIcon={<CircleCheck size={15} aria-hidden="true" />}
                  onClick={() => onDecision(approval.approvalRequestId, 'approve')}
                >
                  Approve
                </Button>
              </div>
            ) : (
              <StatusBadge tone={approval.state === 'rejected' ? 'danger' : 'info'} shape="dot">
                {approval.state}
              </StatusBadge>
            )}
          </div>
        )) : (
          <div
            className="zhiyu-home__delegation-empty"
            data-zhiyu-delegation-approval="not_projected"
          >
            <strong>no pending approval</strong>
            <small>{delegation.candidateIntent.reasonCode}</small>
          </div>
        )}
      </div>
      <div className="zhiyu-home__delegation-diagnostics" aria-label="delegation diagnostics">
        {delegation.diagnosticItems.map((item) => (
          <div
            key={item.diagnosticId}
            className="zhiyu-home__delegation-diagnostic"
            data-zhiyu-delegation-diagnostic={item.diagnosticId}
            data-zhiyu-delegation-firewall-input={item.firewallInputId}
            data-zhiyu-delegation-firewall-verdict={item.firewallVerdict}
            data-zhiyu-delegation-runtime-decision={item.runtimeDecision}
            data-zhiyu-delegation-diagnostic-reason={item.reasonCode}
          >
            <strong>{item.toolName}</strong>
            <small>{item.firewallVerdict} / {item.runtimeDecision}</small>
          </div>
        ))}
      </div>
      <div
        className="zhiyu-home__delegation-audit"
        data-zhiyu-delegation-audit-replay-id={delegation.audit.replayId ?? 'not_projected'}
        data-zhiyu-delegation-audit-replay-outcome={delegation.audit.replayOutcome ?? 'not_projected'}
        data-zhiyu-delegation-audit-action-disposition={delegation.audit.actionDisposition ?? 'not_projected'}
        data-zhiyu-delegation-audit-stage-count={String(delegation.audit.stageCount)}
      >
        <span>{delegation.audit.state}</span>
        <span>{delegation.audit.replayOutcome ?? 'not_projected'}</span>
        <span>{delegation.audit.actionDisposition ?? 'not_projected'}</span>
      </div>
      <p className="zhiyu-home__action-hint">{delegation.actionHint}</p>
    </Surface>
  );
}

function DelegationField({
  label,
  value,
}: {
  readonly label: string;
  readonly value: string | null;
}) {
  return (
    <div className="zhiyu-home__delegation-field">
      <span>{label}</span>
      <strong>{value ?? 'not_projected'}</strong>
    </div>
  );
}

function toneForDelegationState(state: ZhiyuDelegationUxState) {
  switch (state) {
    case 'diagnostic':
    case 'idle':
      return 'success';
    case 'firewall-blocked':
    case 'denied':
      return 'danger';
    case 'pending-approval':
      return 'warning';
    case 'blocked':
    default:
      return 'neutral';
  }
}
