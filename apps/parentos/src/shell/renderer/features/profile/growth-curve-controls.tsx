import { PillTabs, Surface } from '@nimiplatform/kit/ui';
import { useTranslation } from 'react-i18next';
import { AppSelect } from '../../app-shell/app-select.js';
import type { MeasurementRow } from '../../bridge/sqlite-bridge.js';
import {
  CARD_TYPE_IDS,
  METRIC_CARDS,
  OTHER_TYPE_IDS,
  computeBMI,
  formatRecencyLabel,
  getLatestMeasurement,
  getStaleMeasurementDays,
  type GrowthMetricDefinition,
} from './growth-curve-page-shared.js';

// growth-curve-controls.tsx — restyled to pill-tabs with a recency stamp
// (wave-B). The other-metric select, standard pill toggle, and stale-hint
// surface are preserved with the same behavior.
//
// Recency stamp flows through `formatRecencyLabel`; caller passes `nowIso`.

type GrowthCurveControlsProps = {
  measurements: MeasurementRow[];
  selectedType: string;
  ageMonths: number;
  availableTypes: GrowthMetricDefinition[];
  nowIso: string;
  onSelectType: (typeId: string) => void;
};

export function GrowthCurveControls({
  measurements,
  selectedType,
  ageMonths,
  availableTypes,
  nowIso,
  onSelectType,
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
        className="mb-3 flex flex-wrap items-center gap-3"
        data-testid="growth-curve-controls-pill-tabs"
      >
        <PillTabs
          ariaLabel="生长指标"
          size="sm"
          value={selectedType}
          onValueChange={onSelectType}
          items={visibleCards.map((card) => ({
            value: card.typeId,
            label: (
              <span className="inline-flex items-center gap-1.5">
                <span className="text-[14px]" aria-hidden="true">{card.emoji}</span>
                <span>{card.label}</span>
              </span>
            ),
          }))}
        />
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

      {/* `computedBmi` is currently unused at the controls level (BMI is shown as a tab label only); kept as a no-op reference so the helper import remains live for future re-use. */}
      {computedBmi != null ? null : null}
    </>
  );
}
