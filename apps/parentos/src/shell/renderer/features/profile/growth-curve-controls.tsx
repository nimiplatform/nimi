import { Button, Surface, Tooltip, cn } from '@nimiplatform/nimi-kit/ui';
import { useTranslation } from 'react-i18next';
import { AppSelect } from '../../app-shell/app-select.js';
import type { MeasurementRow } from '../../bridge/sqlite-bridge.js';
import { GROWTH_STANDARD_LABELS, type GrowthStandard, type WHOLMSDataset } from './who-lms-loader.js';
import {
  CARD_TYPE_IDS,
  METRIC_CARDS,
  OTHER_TYPE_IDS,
  computeApproxPercentile,
  computeBMI,
  formatRecencyLabel,
  getGrowthStandardTooltip,
  getLatestMeasurement,
  getStaleMeasurementDays,
  type GrowthMetricDefinition,
} from './growth-curve-page-shared.js';

// growth-curve-controls.tsx — restyled to pill-tabs with inline percentile
// label + recency stamp (wave-B). The other-metric select, standard pill
// toggle, and stale-hint surface are preserved with the same behavior.
//
// All percentile values flow through `computeApproxPercentile` from
// growth-curve-page-shared.ts; no app-local percentile math. Recency stamp
// flows through `formatRecencyLabel`; caller passes `nowIso`.

type GrowthCurveControlsProps = {
  measurements: MeasurementRow[];
  selectedType: string;
  ageMonths: number;
  availableTypes: GrowthMetricDefinition[];
  growthStandard: GrowthStandard;
  whoDataset: WHOLMSDataset | null;
  nowIso: string;
  onSelectType: (typeId: string) => void;
  onSelectGrowthStandard: (standard: GrowthStandard) => void;
};

export function GrowthCurveControls({
  measurements,
  selectedType,
  ageMonths,
  availableTypes,
  growthStandard,
  whoDataset,
  nowIso,
  onSelectType,
  onSelectGrowthStandard,
}: GrowthCurveControlsProps) {
  const { t } = useTranslation();
  const latestHeight = getLatestMeasurement(measurements, 'height');
  const latestWeight = getLatestMeasurement(measurements, 'weight');
  const computedBmi = latestHeight && latestWeight ? computeBMI(latestHeight.value, latestWeight.value) : null;
  const staleDays = getStaleMeasurementDays(measurements);
  const visibleCards = METRIC_CARDS.filter((card) => {
    if (card.maxAgeMonths != null && ageMonths > card.maxAgeMonths) return false;
    if (card.minAgeMonths != null && ageMonths < card.minAgeMonths) return false;
    return true;
  });

  // Recency stamp derived from the most-recent measurement of the active
  // metric (the surface is metric-scoped). Format flows through
  // formatRecencyLabel; no Date.now() in this file.
  const activeLatest = getLatestMeasurement(measurements, selectedType);
  const recencyLabel = activeLatest ? formatRecencyLabel(activeLatest.measuredAt, nowIso) : null;

  return (
    <>
      <div
        className="mb-3 flex flex-wrap items-center gap-2"
        data-testid="growth-curve-controls-pill-tabs"
      >
        {visibleCards.map((card) => {
          const isActive = selectedType === card.typeId;
          const latest = getLatestMeasurement(measurements, card.typeId);
          let percentile: number | null = null;
          if (card.typeId === 'bmi') {
            percentile = null;
          } else if (latest) {
            percentile = computeApproxPercentile(latest.value, latest.ageMonths, whoDataset);
          }
          const percentileLabel = percentile != null ? `P${percentile}` : null;
          return (
            <Button
              key={card.typeId}
              onClick={() => onSelectType(card.typeId)}
              tone={isActive ? 'primary' : 'ghost'}
              size="sm"
              className={cn(
                'min-h-0 rounded-full px-3 py-1.5 text-[13px]',
                !isActive && 'border border-[var(--nimi-border-subtle)]',
              )}
              data-testid={`growth-curve-tab-${card.typeId}`}
            >
              <span className="text-[14px]">{card.emoji}</span>
              <span className="font-medium">{card.label}</span>
              {percentileLabel ? (
                <span
                  className={cn(
                    'text-[12px] font-semibold',
                    isActive ? 'text-[color-mix(in_srgb,var(--nimi-action-primary-fg)_85%,transparent)]' : 'text-[var(--nimi-text-muted)]',
                  )}
                  data-testid={`growth-curve-tab-percentile-${card.typeId}`}
                >
                  {percentileLabel}
                </span>
              ) : null}
            </Button>
          );
        })}
        {recencyLabel ? (
          <span
            className="ml-1 text-[12px] text-[var(--nimi-text-muted)]"
            data-testid="growth-curve-controls-recency"
          >
            最近更新 {recencyLabel}
          </span>
        ) : null}
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
      {/* `computedBmi` is currently unused at the controls level (BMI is shown as a tab label only); kept as a no-op reference so the helper import remains live for future re-use. */}
      {computedBmi != null ? null : null}
    </>
  );
}
