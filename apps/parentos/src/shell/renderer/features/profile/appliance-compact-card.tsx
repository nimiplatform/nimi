import { Button, Surface } from '@nimiplatform/nimi-kit/ui';
import type { CSSProperties } from 'react';
/**
 * Full-width compact card for the appliance that would otherwise be left
 * unpaired in the grid (PO-ORTHO-003a). Instead of shrinking a hero, the odd
 * appliance is promoted to a wide horizontal card: left identity bar → small
 * ring → name / meta / phase → embedded next-action → vertical action stack.
 * This keeps visual weight balanced regardless of appliance count.
 */
import type {
  OrthodonticApplianceRow,
  OrthodonticApplianceType,
  OrthodonticCaseRow,
  OrthodonticCheckinRow,
  OrthodonticUnwearIntervalRow,
} from '../../bridge/sqlite-bridge.js';
import { applianceIdentity } from './appliance-identity.js';
import { computeApplianceRingView } from './appliance-ring-view.js';
import { ApplianceRing } from './appliance-ring.js';
import { computeApplianceNextAction } from './appliance-next-action.js';
import {
  AlignerIndexPill,
  ApplianceCardHeader,
  ApplianceMetaLine,
  AppliancePhasePill,
  DaysAwayPill,
  formatMonthDay,
  type ApplianceCardHandlers,
} from './appliance-card-shared.js';
import {
  applianceSupportsWearGap,
  computeAppliancePhaseProgress,
  computeCycleProgress,
} from './orthodontic-derive.js';

function StackButton({
  label,
  tone,
  onClick,
}: {
  label: string;
  tone: 'primary' | 'outline';
  onClick: () => void;
}) {
  return (
    <Button
      tone={tone === 'primary' ? 'primary' : 'secondary'}
      size="sm"
      onClick={onClick}
      fullWidth
      className="rounded-full whitespace-nowrap"
    >
      {label}
    </Button>
  );
}

export function ApplianceCompactCard({
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
  const ringView = computeApplianceRingView({ appliance, caseRow, intervals, checkins, nowIso });
  const phase = computeAppliancePhaseProgress(appliance, nowIso);
  const nextAction = computeApplianceNextAction({ appliance, intervals, checkins, nowIso });
  const supportsWearGap = applianceSupportsWearGap(appliance.applianceType);
  const identityStyle = {
    '--appliance-identity': applianceIdentity(appliance.applianceType).solid,
  } as CSSProperties;
  const alignerIndex =
    appliance.applianceType === 'clear-aligner'
      ? computeCycleProgress({
          appliance,
          intervals,
          alignerChangeCheckins: checkins,
          nowIso,
        }).currentAlignerIndex
      : null;
  // log-review actions are owned by the case-level review card (PO-ORTHO-015);
  // surfacing the same 下次复诊 inline would just duplicate it. Drop the
  // embedded panel + primary button when that's the only action.
  const showInlineNextAction = nextAction.actionKind !== 'log-review';

  return (
    <Surface
      as="section"
      tone="card"
      material="glass-regular"
      elevation="raised"
      padding="none"
      className="flex items-stretch overflow-hidden rounded-3xl"
    >
      {/* left identity bar */}
      <div
        className={`w-1.5 shrink-0 ${applianceIdentityBarClassName(appliance.applianceType)}`}
        style={identityStyle}
        aria-hidden="true"
      />

      <div
        className="flex flex-1 flex-wrap items-center gap-6 px-6 py-5"
      >
        {/* small ring */}
        <div style={{ flexShrink: 0 }}>
          <ApplianceRing view={ringView} size={104} stroke={10} />
        </div>

        {/* middle: identity + phase + embedded next action */}
        <div className="flex min-w-[220px] flex-1 flex-col gap-2.5">
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

          {/* embedded next action */}
          {showInlineNextAction && (
            <div
              className="flex flex-wrap items-center gap-2.5 rounded-xl bg-[color-mix(in_srgb,var(--nimi-text-primary)_3%,transparent)] px-3.5 py-2.5"
            >
              <span className="text-[12px] font-semibold text-[var(--nimi-text-muted)]">
                {nextAction.label}
              </span>
              <span className="text-[15px] font-bold text-[var(--nimi-text-primary)]">
                {nextAction.date ? formatMonthDay(nextAction.date) : '—'}
              </span>
              {nextAction.daysAway !== null && <DaysAwayPill daysAway={nextAction.daysAway} />}
              {nextAction.detail && (
                <span className="text-[12px] text-[var(--nimi-text-muted)]">· {nextAction.detail}</span>
              )}
            </div>
          )}
        </div>

        {/* right: vertical action stack */}
        <div
          className="flex min-w-[132px] shrink-0 flex-col gap-2"
        >
          {showInlineNextAction && (
            <StackButton
              label={nextAction.actionLabel}
              tone="primary"
              onClick={() => handlers.onNextAction(appliance, nextAction)}
            />
          )}
          {supportsWearGap && (
            <StackButton
              label="补记未戴"
              tone="outline"
              onClick={() => handlers.onBackfillUnwear(appliance)}
            />
          )}
          <StackButton
            label="记录异常"
            tone="outline"
            onClick={() => handlers.onLogIssue(appliance)}
          />
        </div>
      </div>
    </Surface>
  );
}

function applianceIdentityBarClassName(type: OrthodonticApplianceType): string {
  // Clear-aligner uses the indigo identity defined in
  // `appliance-identity.ts`; the kit's --nimi-status-success would mismatch
  // the hero card's top bar / ring stroke since the identity is no longer
  // teal/green. The other types still ride the semantic kit tokens since
  // their hue already aligns with the corresponding kit role.
  if (type === 'clear-aligner') return 'bg-[var(--appliance-identity)]';
  if (type === 'expander' || type === 'retainer-fixed') return 'bg-[var(--nimi-status-info)]';
  if (type === 'retainer-removable') return 'bg-[var(--nimi-status-danger)]';
  if (type === 'metal-braces' || type === 'ceramic-braces') return 'bg-[var(--nimi-text-muted)]';
  return 'bg-[var(--nimi-action-primary-bg)]';
}
