import { Button, IconButton, Tooltip } from '@nimiplatform/kit/ui';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { computeAgeMonths, computeAgeMonthsAt, useAppStore } from '../../app-shell/app-store.js';
import { getMeasurements, updateMeasurement, deleteMeasurement } from '../../bridge/sqlite-bridge.js';
import type { MeasurementRow } from '../../bridge/sqlite-bridge.js';
import { isoNow } from '../../bridge/ulid.js';
import { GROWTH_STANDARDS } from '../../knowledge-base/index.js';
import { catchLog } from '../../infra/telemetry/catch-log.js';
import type { GrowthTypeId } from '../../knowledge-base/gen/growth-standards.gen.js';
import { canRenderWHOLMS, loadWHOLMS, type WHOLMSDataset, type GrowthStandard } from './who-lms-loader.js';
import { AISummaryCard } from './ai-summary-card.js';
import { NoActiveChildPlaceholder } from './_shared/no-active-child-placeholder.js';
import { ProfileDetailShell } from './_shared/profile-detail-shell.js';
import { HealthCaptureModal } from './health-capture-modal.js';
import { GrowthCurveChartPanel } from './growth-curve-chart-panel.js';
import { GrowthCurveControls } from './growth-curve-controls.js';
import { GrowthCurveHistoryTable } from './growth-curve-history-table.js';
import {
  buildGrowthSummaryContext,
  computeBMI,
  getLatestMeasurement,
} from './growth-curve-page-shared.js';
import { buildGrowthDetailSnapshot } from './growth-detail-projection.js';
import { GrowthHeroCard } from './growth-hero-card.js';
import { GrowthMilestonesCard } from './growth-milestones-card.js';
import { GrowthNextCheckModal } from './growth-next-check-modal.js';
import type {
  HealthRecordEvent,
  HealthRecordEventKind,
  HealthRecordValue,
} from '../../engine/health-record-domain.js';
import type { HealthMetricId } from '../../knowledge-base/index.js';

// ---------------------------------------------------------------------------
// In-page adapters (wave-B). Convert the legacy MeasurementRow stream into
// the canonical HealthRecordEvent + HealthRecordValue shape consumed by the
// wave-A projection (`buildGrowthDetailSnapshot`). Bounded to wave-B; the
// canonical writer migration is wave-D.
// ---------------------------------------------------------------------------

const LEGACY_TYPE_TO_METRIC_ID: Record<string, HealthMetricId> = {
  height: 'growth.height',
  weight: 'growth.weight',
  'head-circumference': 'growth.head_circumference',
  bmi: 'growth.bmi',
  'bone-age': 'development.bone_age_years',
};

// Inverse of LEGACY_TYPE_TO_METRIC_ID for the four growth chart tabs — maps a
// canonical health metric id (carried by the /profile group card's ?metric=
// deep link) back to this page's `selectedType` tab id.
const METRIC_ID_TO_GROWTH_TYPE: Partial<Record<HealthMetricId, string>> = {
  'growth.height': 'height',
  'growth.weight': 'weight',
  'growth.head_circumference': 'head-circumference',
  'growth.bmi': 'bmi',
};

const LEGACY_TYPE_TO_UNIT: Record<string, string> = {
  height: 'cm',
  weight: 'kg',
  'head-circumference': 'cm',
  bmi: 'kg/m²',
  'bone-age': 'year',
};

function legacySourceToRecordKind(source: MeasurementRow['source']): HealthRecordEventKind {
  if (source === 'ocr') return 'ocr_confirmed';
  if (source === 'computed') return 'derived';
  return 'manual';
}

function measurementsToHealthRecordSlice(
  measurements: MeasurementRow[],
): { events: HealthRecordEvent[]; values: HealthRecordValue[] } {
  const events: HealthRecordEvent[] = [];
  const values: HealthRecordValue[] = [];
  for (const measurement of measurements) {
    const metricId = LEGACY_TYPE_TO_METRIC_ID[measurement.typeId];
    if (!metricId) continue;
    const createdAt = measurement.createdAt ?? measurement.measuredAt;
    events.push({
      eventId: measurement.measurementId,
      childId: measurement.childId,
      protocolId: 'growth-child-quarterly',
      groupId: 'growth',
      recordKind: legacySourceToRecordKind(measurement.source),
      sourceSurface: 'profile_detail',
      recordedAt: createdAt,
      effectiveDate: measurement.measuredAt,
      ageMonths: measurement.ageMonths,
      recorderId: null,
      linkedReminderStateId: null,
      linkedReminderRuleId: null,
      notes: measurement.notes ?? null,
      metadataJson: null,
      createdAt,
      updatedAt: createdAt,
    });
    values.push({
      valueId: `${measurement.measurementId}:value`,
      eventId: measurement.measurementId,
      childId: measurement.childId,
      metricId,
      valueNumber: measurement.value,
      valueText: null,
      valueJson: null,
      unit: LEGACY_TYPE_TO_UNIT[measurement.typeId] ?? null,
      qualifier: null,
      recordKind: 'measured',
      sourceValueIds: null,
      createdAt,
    });
  }

  // BMI is never persisted as its own measurement row. The canonical
  // health-record projection only derives BMI when one event carries both
  // height and weight — but the per-measurement adapter above emits a
  // separate event per row, so BMI would never derive and the BMI hero would
  // fall back to its no-data state ("添加首次BMI测量后…"). Pair same-date
  // height + weight here and attach a synthetic growth.bmi value to that
  // date's height event. recordKind 'measured' keeps it through
  // recomputeDerivedHealthRecordValues, which only strips 'derived' rows.
  const bmiByDate = new Map<
    string,
    { childId: string; ageMonths: number; createdAt: string; height?: { value: number; eventId: string }; weight?: number }
  >();
  for (const measurement of measurements) {
    if (measurement.typeId !== 'height' && measurement.typeId !== 'weight') continue;
    const date = measurement.measuredAt.split('T')[0] ?? measurement.measuredAt;
    const entry = bmiByDate.get(date) ?? {
      childId: measurement.childId,
      ageMonths: measurement.ageMonths,
      createdAt: measurement.createdAt ?? measurement.measuredAt,
    };
    entry.ageMonths = measurement.ageMonths;
    if (measurement.typeId === 'height') {
      entry.height = { value: measurement.value, eventId: measurement.measurementId };
    } else {
      entry.weight = measurement.value;
    }
    bmiByDate.set(date, entry);
  }
  for (const entry of bmiByDate.values()) {
    if (!entry.height || entry.weight == null) continue;
    values.push({
      valueId: `${entry.height.eventId}:growth.bmi`,
      eventId: entry.height.eventId,
      childId: entry.childId,
      metricId: 'growth.bmi',
      valueNumber: computeBMI(entry.height.value, entry.weight),
      valueText: null,
      valueJson: null,
      unit: 'kg/m²',
      qualifier: null,
      recordKind: 'measured',
      sourceValueIds: null,
      createdAt: entry.createdAt,
    });
  }

  return { events, values };
}

// BMI derive-on-read. The growth Add modal computes BMI live for display but
// only persists growth.height / growth.weight / growth.head_circumference
// rows. The BMI chart series is therefore reconstructed here by pairing
// height + weight measurements taken on the same effective date.
function deriveBmiChartData(
  measurements: MeasurementRow[],
): Array<{ age: number; value: number; date: string }> {
  const byDate = new Map<string, { height?: number; weight?: number; ageMonths: number }>();
  for (const measurement of measurements) {
    if (measurement.typeId !== 'height' && measurement.typeId !== 'weight') continue;
    const date = measurement.measuredAt.split('T')[0] ?? measurement.measuredAt;
    const entry = byDate.get(date) ?? { ageMonths: measurement.ageMonths };
    entry.ageMonths = measurement.ageMonths;
    if (measurement.typeId === 'height') entry.height = measurement.value;
    else entry.weight = measurement.value;
    byDate.set(date, entry);
  }
  const rows: Array<{ age: number; value: number; date: string }> = [];
  for (const [date, entry] of byDate) {
    if (entry.height == null || entry.weight == null) continue;
    rows.push({ age: entry.ageMonths, value: computeBMI(entry.height, entry.weight), date });
  }
  return rows.sort((left, right) => left.age - right.age);
}

// Year-over-year growth rate for the hero chart. Points are grouped by the
// calendar year of `date`; for the first data year the rate is the in-year
// delta (latest − earliest), and for each later data year it is the latest
// value minus the previous data year's latest value. Rates may be negative
// (weight / BMI can drop).
function computeYearlyGrowth(
  chartData: Array<{ age: number; value: number; date: string }>,
): Array<{ year: number; growth: number }> {
  const byYear = new Map<number, { earliestDate: string; earliestValue: number; latestDate: string; latestValue: number }>();
  for (const point of chartData) {
    const year = Number(point.date.slice(0, 4));
    if (!Number.isFinite(year)) continue;
    const entry = byYear.get(year);
    if (!entry) {
      byYear.set(year, {
        earliestDate: point.date,
        earliestValue: point.value,
        latestDate: point.date,
        latestValue: point.value,
      });
      continue;
    }
    if (point.date < entry.earliestDate) {
      entry.earliestDate = point.date;
      entry.earliestValue = point.value;
    }
    if (point.date > entry.latestDate) {
      entry.latestDate = point.date;
      entry.latestValue = point.value;
    }
  }
  const result: Array<{ year: number; growth: number }> = [];
  let previousLatest: number | null = null;
  for (const year of [...byYear.keys()].sort((left, right) => left - right)) {
    const entry = byYear.get(year)!;
    const growth = previousLatest == null
      ? entry.latestValue - entry.earliestValue
      : entry.latestValue - previousLatest;
    result.push({ year, growth });
    previousLatest = entry.latestValue;
  }
  return result;
}

// The hero milestone card shows only the most recent few milestones; the rest
// are reached via its "查看更多" affordance, which leads to the history table.
const HERO_MILESTONE_PREVIEW_LIMIT = 3;

export default function GrowthCurvePage() {
  const { t } = useTranslation();
  const { activeChildId, children } = useAppStore();
  const child = children.find((item) => item.childId === activeChildId);
  const [measurements, setMeasurements] = useState<MeasurementRow[]>([]);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  // Deep link from the /profile group card: ?metric=<healthMetricId> opens the
  // corresponding chart tab (PO-GROWTH-DETAIL-002 admitted query param). Falls
  // back to height when absent or unrecognized.
  const [selectedType, setSelectedType] = useState<string>(
    () => METRIC_ID_TO_GROWTH_TYPE[searchParams.get('metric') as HealthMetricId] ?? 'height',
  );
  const [showForm, setShowForm] = useState(false);
  const [growthStandard, setGrowthStandard] = useState<GrowthStandard>('china');
  const [whoDatasets, setWhoDatasets] = useState<Record<string, WHOLMSDataset | null>>({});
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [editDate, setEditDate] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [showReschedule, setShowReschedule] = useState(false);
  // Scroll target for the hero milestone card's "查看更多" affordance — it
  // brings the full milestone list (the history table) into view.
  const historyTableRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!activeChildId) {
      return;
    }

    getMeasurements(activeChildId).then(setMeasurements).catch(catchLog('growth-curve', 'action:load-measurements-failed'));
  }, [activeChildId]);

  useEffect(() => {
    if (!child) {
      setWhoDatasets({});
      return;
    }

    // Load every metric's LMS reference up front so each tab and cross-metric
    // chip computes its percentile against its own standard — not whichever
    // metric happens to be selected.
    const lmsTypeIds: GrowthTypeId[] = ['height', 'weight', 'head-circumference', 'bmi'];
    let cancelled = false;
    void Promise.all(
      lmsTypeIds.map((typeId) =>
        loadWHOLMS(typeId, child.gender, growthStandard)
          .then((dataset) => [typeId, dataset] as const)
          .catch(() => [typeId, null] as const),
      ),
    ).then((entries) => {
      if (!cancelled) setWhoDatasets(Object.fromEntries(entries));
    });
    return () => {
      cancelled = true;
    };
  }, [child, growthStandard]);

  const latestH = useMemo(() => getLatestMeasurement(measurements, 'height'), [measurements]);
  const latestW = useMemo(() => getLatestMeasurement(measurements, 'weight'), [measurements]);
  const nowIso = useMemo(() => isoNow(), [measurements]);
  // The chart bands track the selected metric; percentile math for other tabs
  // and chips uses each metric's own dataset (keyed by canonical metric id).
  const whoDataset = whoDatasets[selectedType] ?? null;
  const whoDatasetByMetricId = useMemo<Partial<Record<HealthMetricId, WHOLMSDataset | null>>>(() => {
    const byMetricId: Partial<Record<HealthMetricId, WHOLMSDataset | null>> = {};
    for (const [typeId, dataset] of Object.entries(whoDatasets)) {
      const metricId = LEGACY_TYPE_TO_METRIC_ID[typeId];
      if (metricId) byMetricId[metricId] = dataset;
    }
    return byMetricId;
  }, [whoDatasets]);
  const growthDetailSnapshot = useMemo(() => {
    if (!child) return null;
    const slice = measurementsToHealthRecordSlice(measurements);
    const selectedMetricId = LEGACY_TYPE_TO_METRIC_ID[selectedType] ?? 'growth.height';
    try {
      return buildGrowthDetailSnapshot({
        child: {
          childId: child.childId,
          displayName: child.displayName,
          gender: child.gender === 'female' ? 'F' : 'M',
          birthDate: child.birthDate,
        },
        selectedMetricId,
        growthStandard,
        events: slice.events,
        values: slice.values,
        whoDataset,
        whoDatasetByMetricId,
        page: 1,
        perPage: 10,
        filters: { dateRangeKey: 'all', sourceKey: 'all' },
        nowIso,
      });
    } catch {
      return null;
    }
  }, [child, measurements, selectedType, growthStandard, whoDataset, whoDatasetByMetricId, nowIso]);

  // Milestones scoped to the selected metric, newest last. The history table
  // renders all of these; the hero milestone card renders only the most recent
  // `HERO_MILESTONE_PREVIEW_LIMIT` — one source, so the card preview and its
  // "查看更多" destination always agree. `growthDetailSnapshot.milestones` is
  // the full-record set; a milestone belongs to the selected metric when its
  // evidence events are that metric's measurements.
  const selectedMetricMilestones = useMemo(() => {
    const all = growthDetailSnapshot?.milestones ?? [];
    const selectedMeasurementIds = new Set(
      measurements.filter((item) => item.typeId === selectedType).map((item) => item.measurementId),
    );
    return all.filter((milestone) =>
      milestone.evidenceEventIds.some((eventId) => selectedMeasurementIds.has(eventId)),
    );
  }, [growthDetailSnapshot, measurements, selectedType]);

  if (!child) {
    return (
      <ProfileDetailShell title={t('Profile.rich.growth.title')}>
        <NoActiveChildPlaceholder />
      </ProfileDetailShell>
    );
  }

  const typeInfo = GROWTH_STANDARDS.find((standard) => standard.typeId === selectedType);
  const typeMeasurements = measurements
    .filter((measurement) => measurement.typeId === selectedType)
    .sort((left, right) => left.ageMonths - right.ageMonths);

  // BMI is never persisted as its own measurement row — it is derived on read
  // by pairing height + weight measurements taken on the same date. Every
  // other metric reads its stored rows directly.
  const chartData = selectedType === 'bmi'
    ? deriveBmiChartData(measurements)
    : typeMeasurements.map((measurement) => ({
        age: measurement.ageMonths,
        value: measurement.value,
        date: measurement.measuredAt.split('T')[0] ?? measurement.measuredAt,
      }));

  const heroYearlyGrowth = computeYearlyGrowth(chartData);

  const ageMonths = computeAgeMonths(child.birthDate);
  const computedBmi = latestH && latestW ? computeBMI(latestH.value, latestW.value) : null;
  const availableTypes = GROWTH_STANDARDS.filter(
    (standard) => ageMonths >= standard.ageRange.startMonths && ageMonths <= standard.ageRange.endMonths,
  );
  const canShowWhoLines = canRenderWHOLMS(whoDataset, ageMonths);

  const refreshMeasurements = async () => {
    setMeasurements(await getMeasurements(child.childId));
  };

  const navigateToAI = (m: MeasurementRow) => {
    const ti = GROWTH_STANDARDS.find((s) => s.typeId === m.typeId);
    const topic = t('Profile.rich.growth.dataAnalysisTopic', { metric: ti?.displayName ?? m.typeId });
    const lines = [`${child.displayName}，${Math.floor(ageMonths / 12)}岁${ageMonths % 12}个月`,
      `${ti?.displayName ?? m.typeId}: ${m.value} ${ti?.unit ?? ''}（${m.measuredAt.split('T')[0]}）`];
    if (latestH) lines.push(t('Profile.rich.growth.latestHeight', { value: latestH.value }));
    if (latestW) lines.push(t('Profile.rich.growth.latestWeight', { value: latestW.value }));
    const desc = lines.join('\\n');
    navigate(`/advisor?topic=${encodeURIComponent(topic)}&desc=${encodeURIComponent(desc)}`);
  };

  const handleEditMeasurement = (measurement: MeasurementRow) => {
    setEditingId(measurement.measurementId);
    setEditValue(String(measurement.value));
    setEditDate(measurement.measuredAt.split('T')[0] || '');
  };

  const handleSaveEdit = async (measurement: MeasurementRow) => {
    const nextValue = parseFloat(editValue);
    if (Number.isNaN(nextValue)) return;
    const age = computeAgeMonthsAt(child.birthDate, editDate);
    try {
      await updateMeasurement({
        measurementId: measurement.measurementId,
        value: nextValue,
        measuredAt: editDate,
        ageMonths: age,
        percentile: measurement.percentile,
        source: measurement.source,
        notes: measurement.notes,
        now: isoNow(),
      });
      await refreshMeasurements();
      setEditingId(null);
    } catch { /* bridge unavailable */ }
  };

  const handleDeleteMeasurement = async (measurementId: string) => {
    try {
      await deleteMeasurement(measurementId);
      await refreshMeasurements();
    } catch { /* bridge unavailable */ }
    setDeletingId(null);
  };

  return (
    <ProfileDetailShell
      title={
        <span className="flex items-center gap-2">
          <span>{t('Profile.rich.growth.title')}</span>
          <Tooltip
            placement="bottom"
            contentClassName="w-[360px] p-4 text-[13px] leading-relaxed text-[var(--nimi-text-secondary)]"
            content={(
              <>
                <p className="mb-2.5 text-[14px] font-semibold text-[var(--nimi-text-primary)]">数据参考文献</p>
                <ul className="space-y-2.5">
                  <li>
                    <span className="font-medium text-[var(--nimi-status-success)]">身高 · 体重 · BMI 百分位曲线（0-5岁）</span>
                    <span className="mt-0.5 block text-[12px] text-[var(--nimi-text-secondary)]">WHO Child Growth Standards (2006). Length/height-for-age, weight-for-age, BMI-for-age.</span>
                    <span className="block text-[12px] text-[var(--nimi-text-muted)]">World Health Organization Multicentre Growth Reference Study Group</span>
                  </li>
                  <li>
                    <span className="font-medium text-[var(--nimi-status-success)]">身高 · 体重 · BMI 百分位曲线（5-19岁）</span>
                    <span className="mt-0.5 block text-[12px] text-[var(--nimi-text-secondary)]">WHO Growth References (2007). Height-for-age, weight-for-age, BMI-for-age references for school-age children and adolescents.</span>
                    <span className="block text-[12px] text-[var(--nimi-text-muted)]">de Onis M, et al. Bull World Health Organ 2007;85:660-667</span>
                  </li>
                  <li>
                    <span className="font-medium text-[var(--nimi-status-success)]">头围百分位曲线（0-36月）</span>
                    <span className="mt-0.5 block text-[12px] text-[var(--nimi-text-secondary)]">WHO Child Growth Standards (2006). Head circumference-for-age.</span>
                    <span className="block text-[12px] text-[var(--nimi-text-muted)]">覆盖: 0-36个月 · 分男/女 · P3-P97 百分位线</span>
                  </li>
                  <li>
                    <span className="font-medium text-[var(--nimi-status-success)]">骨龄评估</span>
                    <span className="mt-0.5 block text-[12px] text-[var(--nimi-text-secondary)]">Greulich-Pyle Atlas / Tanner-Whitehouse 3 (TW3) 骨龄评估标准</span>
                  </li>
                </ul>
                <p className="mt-2.5 border-t border-[var(--nimi-border-subtle)] pt-2 text-[12px] text-[var(--nimi-text-muted)]">百分位线: P3 · P10 · P25 · P50 (中位数) · P75 · P90 · P97 · 低于P3或高于P97建议咨询专业人士</p>
              </>
            )}
          >
            <IconButton
              aria-label="数据参考文献"
              size="sm"
              tone="ghost"
              className="min-h-0 w-[22px] rounded-full text-[var(--nimi-text-muted)]"
              icon={(
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" />
                </svg>
              )}
            />
          </Tooltip>
        </span>
      }
      actions={
        <Button
          onClick={() => setShowForm(true)}
          tone="primary"
          size="sm"
          className="min-h-0 rounded-full px-3 py-1.5 text-[14px]"
        >
          + {t('Profile.rich.common.addRecord')}
        </Button>
      }
      aiSummary={
        <AISummaryCard domain="growth" childName={child.displayName} childId={child.childId}
          ageLabel={`${Math.floor(ageMonths/12)}岁${ageMonths%12}个月`} gender={child.gender}
          dataContext={buildGrowthSummaryContext(measurements, computedBmi)}
        />
      }
    >
      <GrowthCurveControls
        measurements={measurements}
        selectedType={selectedType}
        ageMonths={ageMonths}
        availableTypes={availableTypes}
        nowIso={nowIso}
        onSelectType={setSelectedType}
      />

      {growthDetailSnapshot ? (
        <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-[1.5fr_1fr] lg:items-stretch">
          <GrowthHeroCard
            headline={growthDetailSnapshot.headline}
            trendStats={growthDetailSnapshot.trendStats}
            selectedMetricDisplayName={growthDetailSnapshot.selectedMetric.displayName || typeInfo?.displayName || selectedType}
            selectedMetricUnit={growthDetailSnapshot.selectedMetric.unit || typeInfo?.unit || ''}
            yearlyGrowth={heroYearlyGrowth}
          />
          <GrowthMilestonesCard
            milestones={selectedMetricMilestones.slice(-HERO_MILESTONE_PREVIEW_LIMIT)}
            headline={growthDetailSnapshot.headline}
            nextCheck={growthDetailSnapshot.nextCheck}
            onReschedule={() => setShowReschedule(true)}
            onViewMore={
              selectedMetricMilestones.length > HERO_MILESTONE_PREVIEW_LIMIT
                ? () => historyTableRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                : undefined
            }
          />
        </div>
      ) : null}

      <GrowthCurveChartPanel
        chartData={chartData}
        selectedType={selectedType}
        typeInfo={typeInfo}
        whoDataset={whoDataset}
        canShowWhoLines={canShowWhoLines}
        growthStandard={growthStandard}
        onSelectGrowthStandard={setGrowthStandard}
        measurements={measurements}
        ageMonths={ageMonths}
      />

      <div className="flex flex-wrap gap-3">
        {showForm ? (
          <HealthCaptureModal
            open
            hideSidebar
            childId={child.childId}
            childBirthDate={child.birthDate}
            initialGroupId="growth"
            initialMetricId={growthDetailSnapshot?.selectedMetric.metricId ?? 'growth.height'}
            linkedReminder={null}
            onClose={() => setShowForm(false)}
            onSaved={() => void refreshMeasurements()}
          />
        ) : null}

        {showReschedule ? (
          <GrowthNextCheckModal
            child={child}
            onSaved={() => void refreshMeasurements()}
            onClose={() => setShowReschedule(false)}
          />
        ) : null}
      </div>

      <div ref={historyTableRef}>
        <GrowthCurveHistoryTable
          typeMeasurements={typeMeasurements}
          typeInfo={typeInfo}
          whoDataset={whoDataset}
          milestones={selectedMetricMilestones}
          editingId={editingId}
          editValue={editValue}
          editDate={editDate}
          deletingId={deletingId}
          onAnalyze={navigateToAI}
          onStartEdit={handleEditMeasurement}
          onEditValueChange={setEditValue}
          onEditDateChange={setEditDate}
          onSaveEdit={(measurement) => void handleSaveEdit(measurement)}
          onCancelEdit={() => setEditingId(null)}
          onRequestDelete={setDeletingId}
          onCancelDelete={() => setDeletingId(null)}
          onConfirmDelete={(measurementId) => void handleDeleteMeasurement(measurementId)}
        />
      </div>
    </ProfileDetailShell>
  );
}
