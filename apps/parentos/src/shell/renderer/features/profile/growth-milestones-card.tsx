import { Surface } from '@nimiplatform/nimi-kit/ui';
import type { GrowthMilestone } from './growth-milestone-rules.js';

// growth-milestones-card.tsx — PO-GROWTH-DETAIL-002 milestone timeline
// composition (wave-C). Pure render of the wave-A projection's
// `GrowthMilestone[]`. No useState/useEffect for projection data, no AI,
// no bridge, no Date.now(). No inlined milestone rule thresholds or title
// templates — all display fields come from the typed projection rows.
// Excludes the predicted-adult-height chip per design.md §10.

const EMPTY_STATE_COPY = '过去 12 个月暂无识别到的里程碑事件';

const KIND_ICONS: Record<GrowthMilestone['kind'], string> = {
  threshold_crossed: '🎯',
  percentile_shift: '📈',
  measurement_density: '📒',
};

const KIND_TONE_CLASSNAMES: Record<GrowthMilestone['kind'], string> = {
  threshold_crossed:
    'border-[color-mix(in_srgb,var(--nimi-status-success)_26%,var(--nimi-border-subtle))] bg-[color-mix(in_srgb,var(--nimi-status-success)_6%,var(--nimi-surface-card))]',
  percentile_shift:
    'border-[color-mix(in_srgb,var(--nimi-status-info)_26%,var(--nimi-border-subtle))] bg-[color-mix(in_srgb,var(--nimi-status-info)_6%,var(--nimi-surface-card))]',
  measurement_density:
    'border-[color-mix(in_srgb,var(--nimi-text-muted)_22%,var(--nimi-border-subtle))] bg-[var(--nimi-surface-card)]',
};

export interface GrowthMilestonesCardProps {
  milestones: GrowthMilestone[];
}

export function GrowthMilestonesCard(props: GrowthMilestonesCardProps) {
  const { milestones } = props;

  if (milestones.length === 0) {
    return (
      <Surface
        tone="card"
        material="solid"
        elevation="base"
        padding="md"
        className="mb-5"
        data-testid="growth-milestones-card-empty"
      >
        <div className="flex items-center gap-2">
          <span className="text-[16px]" aria-hidden="true">📒</span>
          <h3 className="text-[14px] font-semibold text-[var(--nimi-text-primary)]">近一年里程碑</h3>
        </div>
        <p className="mt-2 text-[13px] text-[var(--nimi-text-muted)]">{EMPTY_STATE_COPY}</p>
      </Surface>
    );
  }

  const sorted = [...milestones].sort((a, b) =>
    b.occurredAt.localeCompare(a.occurredAt),
  );

  return (
    <Surface
      tone="card"
      material="solid"
      elevation="raised"
      padding="md"
      className="mb-5"
      data-testid="growth-milestones-card"
    >
      <div className="mb-3 flex items-center gap-2">
        <span className="text-[16px]" aria-hidden="true">📒</span>
        <h3 className="text-[14px] font-semibold text-[var(--nimi-text-primary)]">近一年里程碑</h3>
      </div>
      <ul className="space-y-2">
        {sorted.map((milestone) => (
          <li
            key={milestone.milestoneId}
            data-testid={`growth-milestone-row-${milestone.milestoneId}`}
            className={`flex items-start gap-3 rounded-2xl border px-3 py-2 ${KIND_TONE_CLASSNAMES[milestone.kind]}`}
          >
            <span className="text-[18px]" aria-hidden="true">{KIND_ICONS[milestone.kind]}</span>
            <div className="flex min-w-0 flex-1 items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[14px] font-semibold leading-tight text-[var(--nimi-text-primary)]">
                  {milestone.title}
                </p>
                <p className="mt-0.5 text-[12px] text-[var(--nimi-text-muted)]">
                  {milestone.detailLine}
                </p>
              </div>
              <div className="shrink-0 text-right">
                <p className="text-[14px] font-semibold leading-none text-[var(--nimi-text-primary)]">
                  {milestone.deltaMagnitudeDisplay}
                </p>
                <p className="mt-1 text-[11px] uppercase tracking-wide text-[var(--nimi-text-muted)]">
                  {milestone.deltaUnitLabel}
                </p>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </Surface>
  );
}
