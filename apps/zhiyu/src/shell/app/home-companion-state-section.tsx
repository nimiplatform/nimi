import { Activity } from 'lucide-react';
import { StatusBadge, Surface } from '@nimiplatform/kit/ui';
import type { ZhiyuEvidence } from './evidence';
import type { ZhiyuHomeGatedSurface } from './home-product-state';

export function CompanionStateSection({
  surface,
  companion,
}: {
  readonly surface: ZhiyuHomeGatedSurface;
  readonly companion: ZhiyuEvidence['companion'];
}) {
  const projectedFields = companion.projectedFields.length;
  const proactive = companion.proactiveInterruptibility;
  return (
    <Surface
      as="section"
      className="zhiyu-home__gated zhiyu-home__companion-state"
      data-zhiyu-region="companion"
      data-zhiyu-gated-surface="companion"
      data-zhiyu-companion-state={companion.state}
      data-zhiyu-companion-ready={String(companion.ready)}
      data-zhiyu-companion-reason={companion.reasonCode}
      data-zhiyu-companion-status-text={companion.statusText ?? 'not_projected'}
      data-zhiyu-companion-state-updated-at={companion.stateUpdatedAt ?? 'not_projected'}
      data-zhiyu-companion-current-emotion={companion.currentEmotion ?? 'not_projected'}
      data-zhiyu-companion-participation-mode={companion.participationMode}
      data-zhiyu-companion-participation-source={companion.participationSource ?? 'not_projected'}
      data-zhiyu-companion-projected-count={String(projectedFields)}
      data-zhiyu-proactive-state={proactive.state}
      data-zhiyu-proactive-mode={proactive.mode ?? 'not_projected'}
      data-zhiyu-proactive-opt-in-state={proactive.optInState ?? 'not_projected'}
      data-zhiyu-proactive-delivery-channel={proactive.deliveryChannel ?? 'not_projected'}
      data-zhiyu-proactive-quiet-hours={proactive.quietHoursState ?? 'not_projected'}
      data-zhiyu-proactive-frequency-cap={proactive.frequencyCapState ?? 'not_projected'}
      data-zhiyu-proactive-suppression-reason={proactive.lastSuppressionReason ?? 'not_projected'}
      material="glass-thin"
      elevation="base"
      padding="md"
    >
      <div className="zhiyu-home__section-heading">
        <Activity size={18} aria-hidden="true" />
        <div>
          <h2>{surface.title}</h2>
          <p>{surface.description}</p>
        </div>
      </div>
      <div className="zhiyu-home__companion-summary">
        <StatusBadge tone={companion.ready ? 'success' : 'warning'} shape="dot">
          {companion.reasonCode}
        </StatusBadge>
        <span>{projectedFields} projected</span>
        <span>{companion.observedAt ?? 'not observed'}</span>
      </div>
      <div className="zhiyu-home__companion-grid" aria-label="Runtime Agent state projection">
        <CompanionStateField label="executionState" value={companion.executionState} />
        <CompanionStateField label="statusText" value={companion.statusText} />
        <CompanionStateField label="activeWorldId" value={companion.activeWorldId} />
        <CompanionStateField label="activeUserId" value={companion.activeUserId} />
        <CompanionStateField label="stateUpdatedAt" value={companion.stateUpdatedAt} />
        <CompanionStateField label="currentEmotion" value={companion.currentEmotion} />
        <CompanionStateField label="participationMode" value={companion.participationMode} />
        <CompanionStateField label="participationSource" value={companion.participationSource} />
      </div>
      <ProactiveInterruptibilityPanel proactive={proactive} />
      <div className="zhiyu-home__companion-unsupported" aria-label="Companion state not admitted projections">
        {companion.unsupportedExplainabilityFields.map((field) => (
          <span
            key={field}
            data-zhiyu-companion-unsupported-field={field}
            data-zhiyu-companion-unsupported-state="not_admitted"
          >
            {field}: not_admitted
          </span>
        ))}
      </div>
      <p className="zhiyu-home__action-hint">{companion.actionHint}</p>
    </Surface>
  );
}

function ProactiveInterruptibilityPanel({
  proactive,
}: {
  readonly proactive: ZhiyuEvidence['companion']['proactiveInterruptibility'];
}) {
  return (
    <div
      className="zhiyu-home__proactive"
      aria-label="Runtime proactive interruptibility"
      data-zhiyu-proactive-interruptibility={proactive.state}
      data-zhiyu-proactive-ready={String(proactive.ready)}
      data-zhiyu-proactive-delivery-ready={String(proactive.deliveryReady)}
      data-zhiyu-proactive-reason={proactive.reasonCode}
      data-zhiyu-proactive-suggested-reason={proactive.suggestedReasonCode ?? 'not_projected'}
      data-zhiyu-proactive-delivered-reason={proactive.lastDeliveredReasonCode ?? 'not_projected'}
      data-zhiyu-proactive-suppressed-reason={proactive.lastSuppressedReasonCode ?? 'not_projected'}
      data-zhiyu-proactive-source-hook={proactive.sourceHookId ?? 'not_projected'}
      data-zhiyu-proactive-source-cadence={proactive.sourceCadenceId ?? 'not_projected'}
    >
      <div className="zhiyu-home__proactive-heading">
        <StatusBadge tone={proactive.deliveryReady ? 'success' : proactive.ready ? 'info' : 'warning'} shape="dot">
          {proactive.state}
        </StatusBadge>
        <span>{proactive.reasonCode}</span>
      </div>
      <div className="zhiyu-home__proactive-grid">
        <ProactiveField label="mode" value={proactive.mode} />
        <ProactiveField label="optInState" value={proactive.optInState} />
        <ProactiveField label="deliveryChannel" value={proactive.deliveryChannel} />
        <ProactiveField label="quietHours" value={proactive.quietHoursState} />
        <ProactiveField label="frequencyCap" value={proactive.frequencyCapState} />
        <ProactiveField label="suppression" value={proactive.lastSuppressionReason} />
      </div>
      <ProactiveAuditRefs refs={proactive.auditRefs} />
      <div className="zhiyu-home__proactive-unsupported" aria-label="Proactive unsupported fields">
        {proactive.unsupportedFields.map((field) => (
          <span
            key={field}
            data-zhiyu-proactive-unsupported-field={field}
            data-zhiyu-proactive-unsupported-state="not_projected"
          >
            {field}: not_projected
          </span>
        ))}
      </div>
    </div>
  );
}

function ProactiveField({
  label,
  value,
}: {
  readonly label: string;
  readonly value: string | null;
}) {
  return (
    <span
      data-zhiyu-proactive-field={label}
      data-zhiyu-proactive-field-state={value ? 'projected' : 'not_projected'}
    >
      {label}: {value ?? 'not_projected'}
    </span>
  );
}

function ProactiveAuditRefs({ refs }: { readonly refs: readonly string[] }) {
  if (refs.length === 0) {
    return (
      <div className="zhiyu-home__proactive-audit" data-zhiyu-proactive-audit-state="empty">
        <span data-zhiyu-proactive-audit-ref="not_projected">audit: not_projected</span>
      </div>
    );
  }
  return (
    <div className="zhiyu-home__proactive-audit" data-zhiyu-proactive-audit-state="projected">
      {refs.map((ref) => (
        <span key={ref} data-zhiyu-proactive-audit-ref={ref}>
          audit: {ref}
        </span>
      ))}
    </div>
  );
}

function CompanionStateField({
  label,
  value,
}: {
  readonly label: string;
  readonly value: string | null;
}) {
  return (
    <div
      className="zhiyu-home__companion-item"
      data-zhiyu-companion-field={label}
      data-zhiyu-companion-field-state={value ? 'projected' : 'not_projected'}
    >
      <span>{label}</span>
      <strong>{value ?? 'not_projected'}</strong>
    </div>
  );
}
