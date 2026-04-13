import { AppSelect } from '../../app-shell/app-select.js';
import { S } from '../../app-shell/page-style.js';
import type { MeasurementRow } from '../../bridge/sqlite-bridge.js';
import { GROWTH_STANDARD_LABELS, type GrowthStandard } from './who-lms-loader.js';
import {
  CARD_TYPE_IDS,
  METRIC_CARDS,
  OTHER_TYPE_IDS,
  computeBMI,
  fmtMeasDate,
  getGrowthStandardTooltip,
  getLatestMeasurement,
  getPreviousMeasurement,
  getStaleMeasurementDays,
  type GrowthMetricDefinition,
} from './growth-curve-page-shared.js';

type GrowthCurveControlsProps = {
  measurements: MeasurementRow[];
  selectedType: string;
  ageMonths: number;
  availableTypes: GrowthMetricDefinition[];
  growthStandard: GrowthStandard;
  onSelectType: (typeId: string) => void;
  onSelectGrowthStandard: (standard: GrowthStandard) => void;
};

export function GrowthCurveControls({
  measurements,
  selectedType,
  ageMonths,
  availableTypes,
  growthStandard,
  onSelectType,
  onSelectGrowthStandard,
}: GrowthCurveControlsProps) {
  const latestHeight = getLatestMeasurement(measurements, 'height');
  const latestWeight = getLatestMeasurement(measurements, 'weight');
  const computedBmi = latestHeight && latestWeight ? computeBMI(latestHeight.value, latestWeight.value) : null;
  const staleDays = getStaleMeasurementDays(measurements);
  const visibleCards = METRIC_CARDS.filter((card) => {
    if (card.maxAgeMonths != null && ageMonths > card.maxAgeMonths) return false;
    if (card.minAgeMonths != null && ageMonths < card.minAgeMonths) return false;
    return true;
  });

  return (
    <>
      <div className="grid gap-3 mb-4" style={{ gridTemplateColumns: `repeat(${visibleCards.length}, 1fr)` }}>
        {visibleCards.map((card) => {
          const isActive = selectedType === card.typeId;
          const measurement = getLatestMeasurement(measurements, card.typeId);
          const previous = getPreviousMeasurement(measurements, card.typeId);
          let displayValue: string;
          let dateLabel: string;
          let delta: number | null = null;

          if (card.typeId === 'bmi') {
            displayValue = computedBmi != null ? `${computedBmi}` : '--';
            const bmiDate = latestHeight && latestWeight
              ? (latestHeight.measuredAt > latestWeight.measuredAt ? latestHeight.measuredAt : latestWeight.measuredAt)
              : null;
            dateLabel = bmiDate ? fmtMeasDate(bmiDate) : '暂无数据';
          } else {
            displayValue = measurement ? `${measurement.value}` : '--';
            dateLabel = measurement ? fmtMeasDate(measurement.measuredAt) : '暂无数据';
            if (measurement && previous) delta = Math.round((measurement.value - previous.value) * 10) / 10;
          }

          return (
            <button
              key={card.typeId}
              onClick={() => onSelectType(card.typeId)}
              className={`${S.radiusSm} p-3 text-left transition-all duration-150`}
              style={{
                background: S.card,
                boxShadow: isActive ? `0 0 0 2px ${S.accent}` : S.shadow,
                border: isActive ? 'none' : undefined,
              }}
            >
              <div className="flex items-start justify-between mb-2">
                <span className="text-[20px]">{card.emoji}</span>
                <span className="text-[10px] font-medium" style={{ color: isActive ? S.accent : S.sub }}>{card.label}</span>
              </div>
              <div className="flex items-baseline gap-1.5">
                <p className="text-[20px] font-bold leading-none" style={{ color: S.text }}>{displayValue}</p>
                {delta != null ? (
                  <span className="text-[10px] font-medium" style={{ color: S.sub }}>
                    {delta >= 0 ? '↑' : '↓'}{delta >= 0 ? '+' : ''}{delta}
                  </span>
                ) : null}
              </div>
              <p className="text-[10px] mt-0.5" style={{ color: S.sub }}>{card.unit}</p>
              <p className="text-[9px] mt-1" style={{ color: dateLabel === '暂无数据' ? '#d4d1cc' : S.sub }}>{dateLabel}</p>
            </button>
          );
        })}
      </div>

      {staleDays != null && staleDays > 90 ? (
        <div className={`${S.radiusSm} px-3 py-2 mb-4 flex items-center gap-2`} style={{ background: '#faf8f0', border: '1px solid #e8e2d0' }}>
          <span className="text-[13px]">📅</span>
          <span className="text-[11px]" style={{ color: '#8a7a5a' }}>
            距离上次测量已过去 {staleDays} 天，建议更新数据
          </span>
        </div>
      ) : null}

      {(() => {
        const others = OTHER_TYPE_IDS
          .map((id) => availableTypes.find((standard) => standard.typeId === id))
          .filter(Boolean);
        if (others.length === 0) return null;
        const isOtherActive = !CARD_TYPE_IDS.has(selectedType as (typeof METRIC_CARDS)[number]['typeId']);
        return (
          <div className="mb-4">
            <AppSelect
              value={isOtherActive ? selectedType : ''}
              onChange={(value) => { if (value) onSelectType(value); }}
              placeholder="其他指标..."
              options={others.map((standard) => ({
                value: standard!.typeId,
                label: `${standard!.displayName} (${standard!.unit})`,
              }))}
              style={{ color: isOtherActive ? S.text : S.sub }}
            />
          </div>
        );
      })()}

      <div className="flex items-center mb-3">
        <div className="flex items-center gap-1.5 p-0.5 rounded-full" style={{ background: '#f0f0ec' }}>
          {(['china', 'who'] as const).map((standard) => {
            const isActive = growthStandard === standard;
            return (
              <div key={standard} className="group/std relative flex items-center">
                <button
                  onClick={() => onSelectGrowthStandard(standard)}
                  className={`flex items-center gap-1 px-3 py-1 text-[11px] font-medium rounded-full transition-all duration-200 ${isActive ? 'text-white shadow-sm' : ''}`}
                  style={isActive ? { background: standard === 'china' ? '#e25c5c' : '#4a90d9', color: '#fff' } : { color: S.sub }}
                >
                  {GROWTH_STANDARD_LABELS[standard]}
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="opacity-50">
                    <circle cx="12" cy="12" r="10" />
                    <path d="M12 16v-4M12 8h.01" />
                  </svg>
                </button>
                <div
                  className="pointer-events-none absolute left-0 top-8 z-50 w-[280px] rounded-xl p-3 text-[11px] leading-relaxed opacity-0 transition-opacity duration-200 group-hover/std:pointer-events-auto group-hover/std:opacity-100 whitespace-pre-line"
                  style={{ background: '#1a2b4a', color: '#e8e5e0', boxShadow: '0 4px 16px rgba(0,0,0,0.2)' }}
                >
                  {getGrowthStandardTooltip(standard)}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}
