import { Button, Surface, Tooltip, cn } from '@nimiplatform/nimi-kit/ui';
import { useTranslation } from 'react-i18next';
import { AppSelect } from '../../app-shell/app-select.js';
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
  const { t } = useTranslation();
  const latestHeight = getLatestMeasurement(measurements, 'height');
  const latestWeight = getLatestMeasurement(measurements, 'weight');
  const computedBmi = latestHeight && latestWeight ? computeBMI(latestHeight.value, latestWeight.value) : null;
  const staleDays = getStaleMeasurementDays(measurements);
  const noDataLabel = t('Profile.rich.growth.noData');
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
            dateLabel = bmiDate ? fmtMeasDate(bmiDate) : noDataLabel;
          } else {
            displayValue = measurement ? `${measurement.value}` : '--';
            dateLabel = measurement ? fmtMeasDate(measurement.measuredAt) : noDataLabel;
            if (measurement && previous) delta = Math.round((measurement.value - previous.value) * 10) / 10;
          }

          return (
            <Surface
              as="button"
              key={card.typeId}
              onClick={() => onSelectType(card.typeId)}
              tone="card"
              elevation="raised"
              padding="sm"
              interactive
              active={isActive}
              className={cn(
                'rounded-2xl text-left transition-all duration-150',
                isActive && 'border-[var(--nimi-action-primary-bg)] ring-2 ring-[var(--nimi-action-primary-bg)]',
              )}
            >
              <div className="flex items-start justify-between mb-2">
                <span className="text-[20px]">{card.emoji}</span>
                <span className={cn('text-[12px] font-medium', isActive ? 'text-[var(--nimi-action-primary-bg)]' : 'text-[var(--nimi-text-muted)]')}>{card.label}</span>
              </div>
              <div className="flex items-baseline gap-1.5">
                <p className="text-[20px] font-bold leading-none text-[var(--nimi-text-primary)]">{displayValue}</p>
                {delta != null ? (
                  <span className="text-[12px] font-medium text-[var(--nimi-text-muted)]">
                    {delta >= 0 ? '↑' : '↓'}{delta >= 0 ? '+' : ''}{delta}
                  </span>
                ) : null}
              </div>
              <p className="text-[12px] mt-0.5 text-[var(--nimi-text-muted)]">{card.unit}</p>
              <p className={cn('text-[12px] mt-1', dateLabel === noDataLabel ? 'text-[var(--nimi-text-subtle)]' : 'text-[var(--nimi-text-muted)]')}>{dateLabel}</p>
            </Surface>
          );
        })}
      </div>

      {staleDays != null && staleDays > 90 ? (
        <Surface
          tone="card"
          elevation="base"
          padding="sm"
          className="mb-4 flex items-center gap-2 rounded-2xl border-[color-mix(in_srgb,var(--nimi-status-warning)_35%,var(--nimi-border-subtle))] bg-[color-mix(in_srgb,var(--nimi-status-warning)_10%,var(--nimi-surface-card))] px-3 py-2"
        >
          <span className="text-[14px]">📅</span>
          <span className="text-[13px] text-[var(--nimi-status-warning)]">
            {t('Profile.rich.growth.staleHint', { days: staleDays })}
          </span>
        </Surface>
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
              placeholder={t('Profile.rich.growth.otherMetrics')}
              options={others.map((standard) => ({
                value: standard!.typeId,
                label: `${standard!.displayName} (${standard!.unit})`,
              }))}
              className={isOtherActive ? 'text-[var(--nimi-text-primary)]' : 'text-[var(--nimi-text-muted)]'}
            />
          </div>
        );
      })()}

      <div className="flex items-center mb-3">
        <Surface tone="panel" elevation="base" padding="none" className="flex items-center gap-1.5 rounded-full p-0.5">
          {(['china', 'who'] as const).map((standard) => {
            const isActive = growthStandard === standard;
            return (
              <Tooltip
                key={standard}
                content={<span className="whitespace-pre-line">{getGrowthStandardTooltip(standard)}</span>}
                contentClassName="w-[280px] p-3 text-[13px] leading-relaxed"
              >
                <Button
                  onClick={() => onSelectGrowthStandard(standard)}
                  tone={isActive ? 'primary' : 'ghost'}
                  size="sm"
                  className="min-h-0 rounded-full px-3 py-1 text-[13px]"
                >
                  {GROWTH_STANDARD_LABELS[standard]}
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="opacity-50">
                    <circle cx="12" cy="12" r="10" />
                    <path d="M12 16v-4M12 8h.01" />
                  </svg>
                </Button>
              </Tooltip>
            );
          })}
        </Surface>
      </div>
    </>
  );
}
