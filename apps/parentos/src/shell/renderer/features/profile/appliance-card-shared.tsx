import { Button, IconButton, StatusBadge, cn } from '@nimiplatform/nimi-kit/ui';
/**
 * Shared building blocks for the multi-appliance orthodontic cards
 * (`appliance-hero-card` / `appliance-compact-card`). Keeping the header,
 * phase pill and log-action row here is what makes the hero and compact
 * variants read as the same component family at two densities.
 */
import type { ReactNode } from 'react';
import type { OrthodonticApplianceRow } from '../../bridge/sqlite-bridge.js';
import { computeAgeMonthsAt } from '../../app-shell/app-store.js';
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

export function DaysAwayPill({ daysAway }: { daysAway: number }) {
  return (
    <StatusBadge
      tone={daysAway < 0 ? 'warning' : 'success'}
      className="whitespace-nowrap px-2.5 py-1 text-[11px] font-semibold"
    >
      {daysAway < 0 ? `已过期 ${-daysAway} 天` : `还有 ${daysAway} 天`}
    </StatusBadge>
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
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span
        aria-hidden="true"
        className="h-2.5 w-2.5 shrink-0 rounded-full bg-[var(--nimi-action-primary-bg)]"
      />
      <span
        className="text-[15px] font-bold text-[var(--nimi-text-primary)]"
      >
        {applianceTypeLabel(appliance.applianceType)}
      </span>
      <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 4 }}>
        {trailing}
        <IconButton
          onClick={() => onEditAppliance(appliance)}
          aria-label="矫治器设置"
          title="矫治器设置"
          tone="ghost"
          size="sm"
          className="h-7 min-h-7 w-7 rounded-full text-[var(--nimi-text-muted)]"
          icon={<GearIcon />}
        />
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
    <div className="mt-1 text-[12px] text-[var(--nimi-text-muted)]">
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
  if (!phase) {
    return (
      <Button
        onClick={() => onAdvancePhase(appliance)}
        tone="ghost"
        size="sm"
        className="min-h-7 rounded-full border-dashed border-[var(--nimi-border-subtle)] px-3 text-[12px] text-[var(--nimi-text-muted)]"
      >
        设置治疗阶段
      </Button>
    );
  }
  return (
    <Button
      onClick={() => onAdvancePhase(appliance)}
      title="推进治疗阶段"
      tone="ghost"
      size="sm"
      className="min-h-7 whitespace-nowrap rounded-full bg-[color-mix(in_srgb,var(--nimi-status-info)_15%,transparent)] px-3 text-[12px] text-[var(--nimi-status-info)]"
    >
      <span
        aria-hidden="true"
        className="h-1.5 w-1.5 rounded-full bg-[var(--nimi-status-info)]"
      />
      {phase.label} · 第 {phase.monthsInPhase} / {phase.expectedMonths} 个月
    </Button>
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
        <Button
          onClick={() => handlers.onBackfillUnwear(appliance)}
          tone="secondary"
          size="md"
          className="rounded-full px-4 text-[13px]"
        >
          补记未戴时段
        </Button>
      )}
      <Button
        onClick={() => handlers.onLogIssue(appliance)}
        tone="primary"
        size="md"
        className={cn('rounded-full px-4 text-[13px]', !supportsWearGap && 'min-w-[128px]')}
      >
        记录异常
      </Button>
    </div>
  );
}
