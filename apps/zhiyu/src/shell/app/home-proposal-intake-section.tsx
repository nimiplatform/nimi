import {
  Button,
  StatusBadge,
  Surface,
} from '@nimiplatform/kit/ui';
import { FilePlus2 } from 'lucide-react';
import type { ZhiyuEvidence } from './evidence';
import type { ZhiyuHomeGatedSurface } from './home-product-state';

export function ProposalIntakeSection({
  surface,
  proposal,
  onSubmit,
}: {
  readonly surface: ZhiyuHomeGatedSurface;
  readonly proposal: ZhiyuEvidence['proposal'];
  readonly onSubmit: () => void;
}) {
  return (
    <Surface
      as="section"
      className="zhiyu-home__gated zhiyu-home__proposal-intake"
      data-zhiyu-region="proposal"
      data-zhiyu-gated-surface="proposal"
      data-zhiyu-proposal-ready={String(proposal.ready)}
      data-zhiyu-proposal-state={proposal.state}
      data-zhiyu-proposal-kind={proposal.proposalKind}
      data-zhiyu-proposal-owner={proposal.ownerDomain}
      data-zhiyu-proposal-risk={proposal.riskTier}
      data-zhiyu-proposal-id={proposal.proposalId ?? 'not_projected'}
      data-zhiyu-proposal-audit-ref={proposal.auditRef ?? 'not_projected'}
      material="glass-thin"
      elevation="base"
      padding="md"
    >
      <div className="zhiyu-home__section-heading">
        <FilePlus2 size={18} aria-hidden="true" />
        <div>
          <h2>{surface.title}</h2>
          <p>{surface.description}</p>
        </div>
      </div>
      <div className="zhiyu-home__proposal-summary">
        <StatusBadge tone={proposal.ready ? 'success' : 'warning'} shape="dot">
          {proposal.ready ? '已提交' : '等待入口'}
        </StatusBadge>
        <span>{proposalKindLabel(proposal.proposalKind)}</span>
        <span>{proposalStateLabel(proposal.state)}</span>
      </div>
      <div className="zhiyu-home__proposal-grid" aria-label="需求入口投影">
        <ProposalField label="归属" value={proposalOwnerLabel(proposal.ownerDomain)} />
        <ProposalField label="能力" value={proposalCapabilityLabel(proposal.requestedCapabilityRef)} />
        <ProposalField label="风险" value={riskLabel(proposal.riskTier)} />
        <ProposalField label="权限" value={proposal.requiredPermissionRefs.length > 0 ? `${proposal.requiredPermissionRefs.length} 项权限` : '无需额外权限'} />
        <ProposalField label="下一步" value={reviewStepLabel(proposal.nextReviewStep)} />
        <ProposalField label="审计" value={proposal.auditRef ? '已记录' : '等待投影'} />
      </div>
      <Button
        type="button"
        tone="secondary"
        size="sm"
        disabled={!proposal.sourceConversationAnchorId}
        leadingIcon={<FilePlus2 size={15} aria-hidden="true" />}
        onClick={onSubmit}
      >
        提交需求
      </Button>
      <p className="zhiyu-home__action-hint">{proposal.actionHint}</p>
    </Surface>
  );
}

function proposalKindLabel(kind: string): string {
  if (kind === 'capability_proposal') return '能力需求';
  return kind.replaceAll('_', ' ');
}

function proposalStateLabel(state: string): string {
  if (state === 'ready') return '已就绪';
  if (state === 'blocked') return '等待开放';
  if (state === 'submitted') return '已提交';
  return state.replaceAll('_', ' ');
}

function proposalOwnerLabel(owner: string): string {
  if (owner === 'Platform') return '平台审核';
  return owner;
}

function proposalCapabilityLabel(capability: string): string {
  if (capability.includes('text.generate')) return '文本生成';
  if (capability.includes('image.generate')) return '图片生成';
  return capability;
}

function riskLabel(risk: string): string {
  if (risk === 'low') return '低';
  if (risk === 'medium') return '中';
  if (risk === 'high') return '高';
  return risk;
}

function reviewStepLabel(step: string): string {
  if (step === 'platform_review_capability_proposal') return '等待平台审核';
  return step.replaceAll('_', ' ');
}

function ProposalField({
  label,
  value,
}: {
  readonly label: string;
  readonly value: string;
}) {
  return (
    <div className="zhiyu-home__proposal-field">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
