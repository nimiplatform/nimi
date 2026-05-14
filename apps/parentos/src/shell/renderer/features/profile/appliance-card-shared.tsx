/**
 * Shared building blocks for the multi-appliance orthodontic cards
 * (`appliance-hero-card` / `appliance-compact-card`). Keeping the header,
 * phase pill and log-action row here is what makes the hero and compact
 * variants read as the same component family at two densities.
 */
import type { ReactNode } from 'react';
import type { OrthodonticApplianceRow } from '../../bridge/sqlite-bridge.js';
import { computeAgeMonthsAt } from '../../app-shell/app-store.js';
import { S } from '../../app-shell/page-style.js';
import { applianceIdentity } from './appliance-identity.js';
import { applianceTypeLabel } from './orthodontic-derive.js';
import type { ApplianceNextAction } from './appliance-next-action.js';
import type { AppliancePhaseProgress } from './orthodontic-derive.js';
import { GearIcon } from './orthodontic-treatment-card-parts.js';

/** Cross-card per-appliance action callbacks, keyed by the appliance row. */
export interface ApplianceCardHandlers {
  onEditAppliance: (appliance: OrthodonticApplianceRow) => void;
  onBackfillUnwear: (appliance: OrthodonticApplianceRow) => void;
  onLogIssue: (appliance: OrthodonticApplianceRow) => void;
  onAdvancePhase: (appliance: OrthodonticApplianceRow) => void;
  onNextAction: (appliance: OrthodonticApplianceRow, action: ApplianceNextAction) => void;
}

/** "M 月 D 日" from a yyyy-mm-dd date. */
export function formatMonthDay(ymd: string): string {
  const [, m, d] = ymd.split('-');
  if (!m || !d) return ymd;
  return `${Number(m)} 月 ${Number(d)} 日`;
}

/** "9 岁 6 月" — child age at the appliance start date. */
export function ageAtLabel(birthDate: string, startedAt: string): string {
  const months = computeAgeMonthsAt(birthDate, startedAt);
  const years = Math.floor(months / 12);
  const rem = months % 12;
  return rem > 0 ? `${years} 岁 ${rem} 月` : `${years} 岁`;
}

/** Soft amber pill used to flag an overdue date across the cards. */
function daysAwayTone(daysAway: number | null): { bg: string; color: string } {
  if (daysAway !== null && daysAway < 0) {
    return { bg: 'rgba(245,158,11,0.18)', color: '#9a6404' };
  }
  return { bg: 'rgba(16,185,129,0.18)', color: '#047857' };
}

export function DaysAwayPill({ daysAway }: { daysAway: number }) {
  const tone = daysAwayTone(daysAway);
  return (
    <span
      style={{
        fontSize: 11,
        padding: '3px 9px',
        borderRadius: 999,
        background: tone.bg,
        color: tone.color,
        fontWeight: 600,
        whiteSpace: 'nowrap',
      }}
    >
      {daysAway < 0 ? `已过期 ${-daysAway} 天` : `还有 ${daysAway} 天`}
    </span>
  );
}

/** Color dot + appliance name + (optional) gear button. */
export function ApplianceCardHeader({
  appliance,
  onEditAppliance,
  trailing,
}: {
  appliance: OrthodonticApplianceRow;
  onEditAppliance: (appliance: OrthodonticApplianceRow) => void;
  trailing?: ReactNode;
}) {
  const identity = applianceIdentity(appliance.applianceType);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span
        aria-hidden="true"
        style={{
          width: 9,
          height: 9,
          borderRadius: 999,
          background: identity.solid,
          flexShrink: 0,
        }}
      />
      <span
        style={{ fontSize: 15, fontWeight: 700, color: 'var(--nimi-text-primary)' }}
      >
        {applianceTypeLabel(appliance.applianceType)}
      </span>
      <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 4 }}>
        {trailing}
        <button
          type="button"
          onClick={() => onEditAppliance(appliance)}
          aria-label="矫治器设置"
          title="矫治器设置"
          style={{
            width: 28,
            height: 28,
            padding: 0,
            border: 0,
            borderRadius: 999,
            display: 'inline-grid',
            placeItems: 'center',
            cursor: 'pointer',
            color: 'var(--nimi-text-muted)',
            background: 'transparent',
            transition: 'all 160ms',
          }}
          className="hover:bg-black/5 hover:text-[var(--nimi-text-primary)]"
        >
          <GearIcon />
        </button>
      </div>
    </div>
  );
}

/** "上颌螺旋扩弓 · 起始 2026-02-12 · 9 岁 6 月" meta line. */
export function ApplianceMetaLine({
  appliance,
  childBirthDate,
}: {
  appliance: OrthodonticApplianceRow;
  childBirthDate: string;
}) {
  return (
    <div style={{ fontSize: 12, color: S.sub, marginTop: 4 }}>
      起始 {appliance.startedAt} · {ageAtLabel(childBirthDate, appliance.startedAt)}
    </div>
  );
}

/**
 * Per-appliance treatment-phase pill (PO-ORTHO-013). Renders the phase label +
 * month counter when a phase is set, otherwise a muted "设置阶段" affordance
 * that opens the phase-advance dialog (the first advance sets the initial phase).
 */
export function AppliancePhasePill({
  appliance,
  phase,
  onAdvancePhase,
}: {
  appliance: OrthodonticApplianceRow;
  phase: AppliancePhaseProgress | null;
  onAdvancePhase: (appliance: OrthodonticApplianceRow) => void;
}) {
  const identity = applianceIdentity(appliance.applianceType);
  if (!phase) {
    return (
      <button
        type="button"
        onClick={() => onAdvancePhase(appliance)}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          padding: '4px 12px',
          borderRadius: 999,
          fontSize: 12,
          fontWeight: 600,
          border: '1px dashed rgba(15,23,42,0.2)',
          background: 'transparent',
          color: 'var(--nimi-text-muted)',
          cursor: 'pointer',
          fontFamily: 'inherit',
        }}
      >
        设置治疗阶段
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={() => onAdvancePhase(appliance)}
      title="推进治疗阶段"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '4px 12px',
        borderRadius: 999,
        fontSize: 12,
        fontWeight: 600,
        border: 0,
        background: identity.tint,
        color: identity.tintText,
        cursor: 'pointer',
        fontFamily: 'inherit',
        whiteSpace: 'nowrap',
      }}
    >
      <span
        aria-hidden="true"
        style={{ width: 6, height: 6, borderRadius: 999, background: identity.solid }}
      />
      {phase.label} · 第 {phase.monthsInPhase} / {phase.expectedMonths} 个月
    </button>
  );
}

/**
 * Log-action row shown under the ring. `补记未戴时段` only appears for
 * wear-gap appliance types (PO-ORTHO-005a); `记录异常` is always present.
 */
export function ApplianceLogActions({
  appliance,
  supportsWearGap,
  handlers,
}: {
  appliance: OrthodonticApplianceRow;
  supportsWearGap: boolean;
  handlers: Pick<ApplianceCardHandlers, 'onBackfillUnwear' | 'onLogIssue'>;
}) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        gap: 10,
        flexWrap: 'wrap',
      }}
    >
      {supportsWearGap && (
        <button
          type="button"
          onClick={() => handlers.onBackfillUnwear(appliance)}
          className="hover:-translate-y-0.5"
          style={{
            border: `1px solid ${S.accent}`,
            background: '#ffffff',
            color: 'var(--nimi-text-primary)',
            padding: '9px 18px',
            borderRadius: 999,
            cursor: 'pointer',
            fontSize: 13,
            fontWeight: 600,
            fontFamily: 'inherit',
            transition: 'all 160ms',
          }}
        >
          补记未戴时段
        </button>
      )}
      <button
        type="button"
        onClick={() => handlers.onLogIssue(appliance)}
        className="text-white hover:-translate-y-0.5"
        style={{
          background: 'var(--nimi-text-primary)',
          border: 0,
          padding: '10px 18px',
          borderRadius: 999,
          cursor: 'pointer',
          fontSize: 13,
          fontWeight: 600,
          fontFamily: 'inherit',
          boxShadow: '0 6px 18px rgba(15,23,42,0.16)',
          transition: 'all 160ms',
        }}
      >
        记录异常
      </button>
    </div>
  );
}
