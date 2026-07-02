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
          {proposal.reasonCode}
        </StatusBadge>
        <span>{proposal.proposalKind}</span>
        <span>{proposal.state}</span>
      </div>
      <div className="zhiyu-home__proposal-grid" aria-label="proposal intake projection">
        <ProposalField label="owner" value={proposal.ownerDomain} />
        <ProposalField label="capability" value={proposal.requestedCapabilityRef} />
        <ProposalField label="risk" value={proposal.riskTier} />
        <ProposalField label="permissions" value={proposal.requiredPermissionRefs.join(', ') || 'none'} />
        <ProposalField label="next" value={proposal.nextReviewStep} />
        <ProposalField label="audit" value={proposal.auditRef ?? 'not_projected'} />
      </div>
      <Button
        type="button"
        tone="secondary"
        size="sm"
        disabled={!proposal.sourceConversationAnchorId}
        leadingIcon={<FilePlus2 size={15} aria-hidden="true" />}
        onClick={onSubmit}
      >
        Submit proposal
      </Button>
      <p className="zhiyu-home__action-hint">{proposal.actionHint}</p>
    </Surface>
  );
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
