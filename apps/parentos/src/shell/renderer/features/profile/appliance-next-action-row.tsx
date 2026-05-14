/**
 * Row of per-appliance "next action" cards for the hero appliances in the
 * grid. Hero cards are narrow, so their forward-looking action (下次换套 /
 * 下次转动 / 下次复诊) is externalised here. Compact-card appliances embed
 * their own next-action inline and are excluded from this row.
 */
import type {
  OrthodonticApplianceRow,
  OrthodonticCheckinRow,
  OrthodonticUnwearIntervalRow,
} from '../../bridge/sqlite-bridge.js';
import { S } from '../../app-shell/page-style.js';
import { applianceIdentity } from './appliance-identity.js';
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
        const identity = applianceIdentity(appliance.applianceType);
        const action = computeApplianceNextAction({ appliance, intervals, checkins, nowIso });
        return (
          <div
            key={appliance.applianceId}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 14,
              padding: '14px 18px',
              borderRadius: 18,
              background: identity.tint,
            }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  fontSize: 12,
                  color: S.sub,
                  fontWeight: 600,
                }}
              >
                <span
                  aria-hidden="true"
                  style={{ width: 6, height: 6, borderRadius: 999, background: identity.solid }}
                />
                {applianceTypeLabel(appliance.applianceType)} · {action.label}
                {action.daysAway !== null && <DaysAwayPill daysAway={action.daysAway} />}
              </div>
              <div
                style={{
                  fontSize: 20,
                  fontWeight: 700,
                  color: 'var(--nimi-text-primary)',
                  marginTop: 4,
                  letterSpacing: '-0.01em',
                }}
              >
                {action.date ? formatMonthDay(action.date) : '—'}
              </div>
              {action.detail && (
                <div style={{ fontSize: 12, color: S.sub, marginTop: 2 }}>{action.detail}</div>
              )}
            </div>
            <button
              type="button"
              onClick={() => onNextAction(appliance, action)}
              className="hover:-translate-y-0.5"
              style={{
                padding: '9px 16px',
                borderRadius: 999,
                fontSize: 13,
                fontWeight: 600,
                fontFamily: 'inherit',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                background: '#ffffff',
                color: 'var(--nimi-text-primary)',
                border: `1px solid ${identity.solid}`,
                transition: 'all 160ms',
                flexShrink: 0,
              }}
            >
              {action.actionLabel}
            </button>
          </div>
        );
      })}
    </div>
  );
}
