import '@nimiplatform/kit/ui';
import type { MeasurementRow } from '../../bridge/sqlite-bridge.js';

type TannerOverviewCardsProps = {
  boneAgeMeasurements: MeasurementRow[];
  bodyFatMeasurements: MeasurementRow[];
  ageMonths: number;
};

export function TannerOverviewCards({
  boneAgeMeasurements,
  bodyFatMeasurements,
  ageMonths,
}: TannerOverviewCardsProps) {
  if (boneAgeMeasurements.length === 0 && bodyFatMeasurements.length === 0) {
    return null;
  }

  return (
    <div className="grid grid-cols-2 gap-3 mb-5">
      {(() => {
        const latest = [...boneAgeMeasurements].sort((left, right) => right.measuredAt.localeCompare(left.measuredAt))[0];
        if (!latest) return <div />;
        const actualYears = ageMonths / 12;
        const diff = latest.value - actualYears;
        const status = Math.abs(diff) <= 1
          ? { label: '正常范围', className: 'border-[color-mix(in_srgb,var(--nimi-status-success)_30%,var(--nimi-border-subtle))] bg-[color-mix(in_srgb,var(--nimi-status-success)_8%,var(--nimi-surface-card))] text-[var(--nimi-status-success)]', dot: 'bg-[var(--nimi-status-success)]' }
          : diff > 1
            ? { label: `偏早 ${Math.abs(diff).toFixed(1)} 年`, className: 'border-[color-mix(in_srgb,var(--nimi-status-warning)_30%,var(--nimi-border-subtle))] bg-[color-mix(in_srgb,var(--nimi-status-warning)_8%,var(--nimi-surface-card))] text-[var(--nimi-status-warning)]', dot: 'bg-[var(--nimi-status-warning)]' }
            : { label: `偏晚 ${Math.abs(diff).toFixed(1)} 年`, className: 'border-[color-mix(in_srgb,var(--nimi-status-info)_30%,var(--nimi-border-subtle))] bg-[color-mix(in_srgb,var(--nimi-status-info)_8%,var(--nimi-surface-card))] text-[var(--nimi-status-info)]', dot: 'bg-[var(--nimi-status-info)]' };
        return (
          <div className={`rounded-2xl border p-4 ${status.className}`}>
            <p className="text-[12px] font-medium text-[var(--nimi-text-muted)]">🦴 骨龄</p>
            <p className="text-[20px] font-bold mt-1 text-[var(--nimi-text-primary)]">{latest.value} 岁</p>
            <div className="flex items-center gap-1 mt-1">
              <span className={`h-1.5 w-1.5 rounded-full ${status.dot}`} />
              <span className="text-[13px]">{status.label}</span>
            </div>
            <p className="text-[12px] mt-1 text-[var(--nimi-text-muted)]">{latest.measuredAt.split('T')[0]}</p>
          </div>
        );
      })()}
      {(() => {
        const latest = [...bodyFatMeasurements].sort((left, right) => right.measuredAt.localeCompare(left.measuredAt))[0];
        if (!latest) return <div />;
        return (
          <div className="rounded-2xl bg-[var(--nimi-surface-panel)] p-4">
            <p className="text-[12px] font-medium text-[var(--nimi-text-muted)]">📊 体脂率</p>
            <p className="text-[20px] font-bold mt-1 text-[var(--nimi-text-primary)]">{latest.value}%</p>
            <p className="text-[12px] mt-1 text-[var(--nimi-text-muted)]">{latest.measuredAt.split('T')[0]}</p>
          </div>
        );
      })()}
    </div>
  );
}
