/**
 * Full-width compact card for the appliance that would otherwise be left
 * unpaired in the grid (PO-ORTHO-003a). Instead of shrinking a hero, the odd
 * appliance is promoted to a wide horizontal card: left identity bar → small
 * ring → name / meta / phase → embedded next-action → vertical action stack.
 * This keeps visual weight balanced regardless of appliance count.
 */
import type {
  OrthodonticApplianceRow,
  OrthodonticCaseRow,
  OrthodonticCheckinRow,
  OrthodonticUnwearIntervalRow,
} from '../../bridge/sqlite-bridge.js';
import { S } from '../../app-shell/page-style.js';
import { applianceIdentity } from './appliance-identity.js';
import { computeApplianceRingView } from './appliance-ring-view.js';
import { ApplianceRing } from './appliance-ring.js';
import { computeApplianceNextAction } from './appliance-next-action.js';
import {
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
  const base = {
    padding: '8px 16px',
    borderRadius: 999,
    fontSize: 13,
    fontWeight: 600,
    fontFamily: 'inherit',
    cursor: 'pointer',
    whiteSpace: 'nowrap' as const,
    transition: 'all 160ms',
    width: '100%',
  };
  return (
    <button
      type="button"
      onClick={onClick}
      className="hover:-translate-y-0.5"
      style={
        tone === 'primary'
          ? {
              ...base,
              background: 'var(--nimi-text-primary)',
              color: '#ffffff',
              border: 0,
              boxShadow: '0 4px 12px rgba(15,23,42,0.16)',
            }
          : {
              ...base,
              background: '#ffffff',
              color: 'var(--nimi-text-primary)',
              border: `1px solid ${S.accent}`,
            }
      }
    >
      {label}
    </button>
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
  const identity = applianceIdentity(appliance.applianceType);
  const ringView = computeApplianceRingView({ appliance, caseRow, intervals, checkins, nowIso });
  const phase = computeAppliancePhaseProgress(appliance, nowIso);
  const nextAction = computeApplianceNextAction({ appliance, intervals, checkins, nowIso });
  const supportsWearGap = applianceSupportsWearGap(appliance.applianceType);

  return (
    <section
      style={{
        background: '#ffffff',
        borderRadius: 24,
        overflow: 'hidden',
        boxShadow: '0 8px 28px rgba(15,23,42,0.07), 0 1px 3px rgba(15,23,42,0.05)',
        display: 'flex',
        alignItems: 'stretch',
      }}
    >
      {/* left identity bar */}
      <div style={{ width: 6, background: identity.solid, flexShrink: 0 }} aria-hidden="true" />

      <div
        style={{
          flex: 1,
          padding: '20px 24px',
          display: 'flex',
          alignItems: 'center',
          gap: 24,
          flexWrap: 'wrap',
        }}
      >
        {/* small ring */}
        <div style={{ flexShrink: 0 }}>
          <ApplianceRing view={ringView} size={104} stroke={10} />
        </div>

        {/* middle: identity + phase + embedded next action */}
        <div style={{ flex: 1, minWidth: 220, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div>
            <ApplianceCardHeader
              appliance={appliance}
              onEditAppliance={handlers.onEditAppliance}
            />
            <ApplianceMetaLine appliance={appliance} childBirthDate={childBirthDate} />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <AppliancePhasePill
              appliance={appliance}
              phase={phase}
              onAdvancePhase={handlers.onAdvancePhase}
            />
          </div>

          {/* embedded next action */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '10px 14px',
              borderRadius: 14,
              background: 'rgba(15,23,42,0.03)',
              flexWrap: 'wrap',
            }}
          >
            <span style={{ fontSize: 12, color: S.sub, fontWeight: 600 }}>
              {nextAction.label}
            </span>
            <span
              style={{
                fontSize: 15,
                fontWeight: 700,
                color: 'var(--nimi-text-primary)',
              }}
            >
              {nextAction.date ? formatMonthDay(nextAction.date) : '—'}
            </span>
            {nextAction.daysAway !== null && <DaysAwayPill daysAway={nextAction.daysAway} />}
            {nextAction.detail && (
              <span style={{ fontSize: 12, color: S.sub }}>· {nextAction.detail}</span>
            )}
          </div>
        </div>

        {/* right: vertical action stack */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            minWidth: 132,
            flexShrink: 0,
          }}
        >
          <StackButton
            label={nextAction.actionLabel}
            tone="primary"
            onClick={() => handlers.onNextAction(appliance, nextAction)}
          />
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
    </section>
  );
}
