/**
 * Vertical hero card for one appliance in the multi-appliance grid
 * (PO-ORTHO-003a). Composition top-to-bottom: identity colour bar → name +
 * meta → phase pill → progress ring → log-action row. The forward-looking
 * "next action" is externalised to `appliance-next-action-row` (the hero is
 * narrow); the full-width compact card embeds it instead.
 */
import type {
  OrthodonticApplianceRow,
  OrthodonticCaseRow,
  OrthodonticCheckinRow,
  OrthodonticUnwearIntervalRow,
} from '../../bridge/sqlite-bridge.js';
import { applianceIdentity } from './appliance-identity.js';
import { computeApplianceRingView } from './appliance-ring-view.js';
import { ApplianceRing } from './appliance-ring.js';
import {
  AlignerIndexPill,
  ApplianceCardHeader,
  ApplianceLogActions,
  ApplianceMetaLine,
  AppliancePhasePill,
  type ApplianceCardHandlers,
} from './appliance-card-shared.js';
import {
  applianceSupportsWearGap,
  computeAppliancePhaseProgress,
  computeCycleProgress,
} from './orthodontic-derive.js';

export function ApplianceHeroCard({
  appliance,
  caseRow,
  childBirthDate,
  intervals,
  checkins,
  nowIso,
  handlers,
}: {
  appliance: OrthodonticApplianceRow;
  caseRow: OrthodonticCaseRow;
  childBirthDate: string;
  intervals: OrthodonticUnwearIntervalRow[];
  checkins: OrthodonticCheckinRow[];
  nowIso: string;
  handlers: ApplianceCardHandlers;
}) {
  const identity = applianceIdentity(appliance.applianceType);
  const ringView = computeApplianceRingView({ appliance, caseRow, intervals, checkins, nowIso });
  const phase = computeAppliancePhaseProgress(appliance, nowIso);
  const supportsWearGap = applianceSupportsWearGap(appliance.applianceType);
  const alignerIndex =
    appliance.applianceType === 'clear-aligner'
      ? computeCycleProgress({
          appliance,
          intervals,
          alignerChangeCheckins: checkins,
          nowIso,
        }).currentAlignerIndex
      : null;

  return (
    <section
      style={{
        background: '#ffffff',
        borderRadius: 24,
        overflow: 'hidden',
        boxShadow: '0 8px 28px rgba(15,23,42,0.07), 0 1px 3px rgba(15,23,42,0.05)',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* identity colour bar */}
      <div style={{ height: 5, background: identity.solid }} aria-hidden="true" />

      <div
        style={{
          padding: '20px 24px 24px',
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
          flex: 1,
        }}
      >
        <div>
          <ApplianceCardHeader
            appliance={appliance}
            onEditAppliance={handlers.onEditAppliance}
            inline={
              alignerIndex !== null ? (
                <AlignerIndexPill
                  currentAlignerIndex={alignerIndex}
                  totalAligners={appliance.totalAligners}
                />
              ) : null
            }
          />
          <ApplianceMetaLine appliance={appliance} childBirthDate={childBirthDate} />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <AppliancePhasePill
            appliance={appliance}
            phase={phase}
            onAdvancePhase={handlers.onAdvancePhase}
          />
        </div>

        <div style={{ display: 'flex', justifyContent: 'center', padding: '4px 0' }}>
          <ApplianceRing view={ringView} size={208} />
        </div>

        <ApplianceLogActions
          appliance={appliance}
          supportsWearGap={supportsWearGap}
          handlers={handlers}
        />
      </div>
    </section>
  );
}
