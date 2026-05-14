import { Button } from '@nimiplatform/nimi-kit/ui';
/**
 * Row of per-appliance "next action" cards for the hero appliances in the
 * grid. Hero cards are narrow, so their forward-looking action (下次换套 /
 * 下次转动 / 下次复诊) is externalised here. Compact-card appliances embed
 * their own next-action inline and are excluded from this row.
 */
import type {
  OrthodonticApplianceRow,
  OrthodonticApplianceType,
  OrthodonticCheckinRow,
  OrthodonticUnwearIntervalRow,
} from '../../bridge/sqlite-bridge.js';
import { applianceTypeLabel } from './orthodontic-derive.js';
import { computeApplianceNextAction } from './appliance-next-action.js';
import {
  DaysAwayPill,
  formatMonthDay,
  type ApplianceCardHandlers,
} from './appliance-card-shared.js';

interface RowAppliance {
  appliance: OrthodonticApplianceRow;
  intervals: OrthodonticUnwearIntervalRow[];
  checkins: OrthodonticCheckinRow[];
}

export function ApplianceNextActionRow({
  appliances,
  nowIso,
  onNextAction,
}: {
  appliances: RowAppliance[];
  nowIso: string;
  onNextAction: ApplianceCardHandlers['onNextAction'];
}) {
  if (appliances.length === 0) return null;
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${Math.min(appliances.length, 2)}, minmax(0, 1fr))`,
        gap: 16,
      }}
    >
      {appliances.map(({ appliance, intervals, checkins }) => {
        const action = computeApplianceNextAction({ appliance, intervals, checkins, nowIso });
        const identityClass = applianceIdentityClassNames(appliance.applianceType);
        return (
          <div
            key={appliance.applianceId}
            className={`flex items-center gap-3.5 rounded-2xl px-[18px] py-3.5 ${identityClass.card}`}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                className="flex items-center gap-1.5 text-[12px] font-semibold text-[var(--nimi-text-muted)]"
              >
                <span
                  aria-hidden="true"
                  className={`h-1.5 w-1.5 rounded-full ${identityClass.dot}`}
                />
                {applianceTypeLabel(appliance.applianceType)} · {action.label}
                {action.daysAway !== null && <DaysAwayPill daysAway={action.daysAway} />}
              </div>
              <div
                className="mt-1 text-[20px] font-bold text-[var(--nimi-text-primary)]"
              >
                {action.date ? formatMonthDay(action.date) : '—'}
              </div>
              {action.detail && (
                <div className="mt-0.5 text-[12px] text-[var(--nimi-text-muted)]">{action.detail}</div>
              )}
            </div>
            <Button
              tone="secondary"
              size="sm"
              onClick={() => onNextAction(appliance, action)}
              className="shrink-0 whitespace-nowrap rounded-full"
            >
              {action.actionLabel}
            </Button>
          </div>
        );
      })}
    </div>
  );
}

function applianceIdentityClassNames(type: OrthodonticApplianceType): { card: string; dot: string } {
  if (type === 'clear-aligner') {
    return {
      card: 'bg-[color-mix(in_srgb,var(--nimi-status-success)_12%,var(--nimi-surface-card))]',
      dot: 'bg-[var(--nimi-status-success)]',
    };
  }
  if (type === 'expander' || type === 'retainer-fixed') {
    return {
      card: 'bg-[color-mix(in_srgb,var(--nimi-status-info)_12%,var(--nimi-surface-card))]',
      dot: 'bg-[var(--nimi-status-info)]',
    };
  }
  if (type === 'retainer-removable') {
    return {
      card: 'bg-[color-mix(in_srgb,var(--nimi-status-danger)_10%,var(--nimi-surface-card))]',
      dot: 'bg-[var(--nimi-status-danger)]',
    };
  }
  if (type === 'metal-braces' || type === 'ceramic-braces') {
    return {
      card: 'bg-[color-mix(in_srgb,var(--nimi-text-muted)_12%,var(--nimi-surface-card))]',
      dot: 'bg-[var(--nimi-text-muted)]',
    };
  }
  return {
    card: 'bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_12%,var(--nimi-surface-card))]',
    dot: 'bg-[var(--nimi-action-primary-bg)]',
  };
}
