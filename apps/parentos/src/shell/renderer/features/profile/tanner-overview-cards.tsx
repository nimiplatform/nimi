import { S } from '../../app-shell/page-style.js';
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
          ? { label: '正常范围', color: '#22c55e', bg: '#f0fdf4' }
          : diff > 1
            ? { label: `偏早 ${Math.abs(diff).toFixed(1)} 年`, color: '#f59e0b', bg: '#fffbeb' }
            : { label: `偏晚 ${Math.abs(diff).toFixed(1)} 年`, color: '#3b82f6', bg: '#eff6ff' };
        return (
          <div className={`${S.radiusSm} p-4`} style={{ background: status.bg, border: `1px solid ${status.color}30` }}>
            <p className="text-[10px] font-medium" style={{ color: S.sub }}>🦴 骨龄</p>
            <p className="text-[20px] font-bold mt-1" style={{ color: S.text }}>{latest.value} 岁</p>
            <div className="flex items-center gap-1 mt-1">
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: status.color }} />
              <span className="text-[11px]" style={{ color: status.color }}>{status.label}</span>
            </div>
            <p className="text-[10px] mt-1" style={{ color: S.sub }}>{latest.measuredAt.split('T')[0]}</p>
          </div>
        );
      })()}
      {(() => {
        const latest = [...bodyFatMeasurements].sort((left, right) => right.measuredAt.localeCompare(left.measuredAt))[0];
        if (!latest) return <div />;
        return (
          <div className={`${S.radiusSm} p-4`} style={{ background: '#f5f3ef' }}>
            <p className="text-[10px] font-medium" style={{ color: S.sub }}>📊 体脂率</p>
            <p className="text-[20px] font-bold mt-1" style={{ color: S.text }}>{latest.value}%</p>
            <p className="text-[10px] mt-1" style={{ color: S.sub }}>{latest.measuredAt.split('T')[0]}</p>
          </div>
        );
      })()}
    </div>
  );
}
