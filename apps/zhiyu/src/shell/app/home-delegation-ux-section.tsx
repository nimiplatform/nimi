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
      data-zhiyu-delegation-required-scopes={delegation.requiredScopes.join(',')}
      data-zhiyu-delegation-granted-scopes={delegation.grantedScopes.join(',')}
      data-zhiyu-delegation-admitted-scopes={delegation.admittedScopes.join(',')}
      data-zhiyu-delegation-scope-evidence-state={delegation.scopeEvidence.evidenceState}
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
          {delegationStateLabel(delegation.state)}
        </StatusBadge>
        <span>{delegation.providerCount} 个服务</span>
        <span>{delegation.pendingApprovalCount} 个待审批</span>
        <span>{delegation.diagnosticCount} 条诊断</span>
      </div>
      <div className="zhiyu-home__delegation-grid" aria-label="委托控制投影">
        <DelegationField label="候选请求" value={delegationProjectionLabel(delegation.candidateIntent.state)} />
        <DelegationField label="预览" value={delegationProjectionLabel(delegation.preview.state)} />
        <DelegationField label="防护" value={delegationProjectionLabel(delegation.outputFirewall.state)} />
        <DelegationField label="审计" value={delegationProjectionLabel(delegation.audit.state)} />
        <DelegationField label="摘要" value={delegation.preview.summaryRef ? '已投影' : null} />
        <DelegationField label="策略快照" value={delegation.preview.policySnapshotId ? '已投影' : null} />
      </div>
      <div className="zhiyu-home__delegation-approvals" aria-label="委托审批">
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
                  拒绝
                </Button>
                <Button
                  type="button"
                  tone="primary"
                  size="sm"
                  leadingIcon={<CircleCheck size={15} aria-hidden="true" />}
                  onClick={() => onDecision(approval.approvalRequestId, 'approve')}
                >
                  同意
                </Button>
              </div>
            ) : (
              <StatusBadge tone={approval.state === 'rejected' ? 'danger' : 'info'} shape="dot">
                {delegationProjectionLabel(approval.state)}
              </StatusBadge>
            )}
          </div>
        )) : (
          <div
            className="zhiyu-home__delegation-empty"
            data-zhiyu-delegation-approval="not_projected"
          >
            <strong>暂无待审批请求</strong>
            <small>出现需要你确认的委托动作后，会显示在这里。</small>
          </div>
        )}
      </div>
      <div className="zhiyu-home__delegation-diagnostics" aria-label="委托诊断">
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
        <span>{delegationProjectionLabel(delegation.audit.state)}</span>
        <span>{delegation.audit.replayOutcome ? '回放已记录' : '回放待投影'}</span>
        <span>{delegation.audit.actionDisposition ? '处置已记录' : '处置待投影'}</span>
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
      <strong>{value ?? '等待投影'}</strong>
    </div>
  );
}

function delegationStateLabel(state: ZhiyuDelegationUxState): string {
  switch (state) {
    case 'diagnostic':
      return '有诊断';
    case 'idle':
      return '已就绪';
    case 'firewall-blocked':
      return '防护拦截';
    case 'denied':
      return '已拒绝';
    case 'pending-approval':
      return '等待审批';
    case 'blocked':
    default:
      return '等待开放';
  }
}

function delegationProjectionLabel(value: string | null): string {
  if (!value || value === 'not_projected') return '等待投影';
  if (value === 'not_available') return '暂不可用';
  if (value === 'ready') return '已就绪';
  if (value === 'blocked') return '等待开放';
  if (value === 'pending') return '待审批';
  if (value === 'rejected') return '已拒绝';
  if (value === 'approved') return '已同意';
  return value.replaceAll('_', ' ');
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
