import { describe, expect, it } from 'vitest';
import type {
  HealthRecordEvent,
  HealthRecordValue,
} from '../../engine/health-record-domain.js';
import {
  buildGrowthDetailSnapshot,
  type GrowthDetailProjectionInput,
} from './growth-detail-projection.js';
import { resolveGrowthRecheckRuleId } from './growth-curve-page-shared.js';
import type { WHOLMSDataset } from './who-lms-loader.js';

const NOW = '2026-05-18T12:00:00.000Z';
const CHILD = {
  childId: 'child-1',
  displayName: 'Snow',
  gender: 'M' as const,
  birthDate: '2016-09-12T00:00:00.000Z',
};

function isoDaysBefore(nowIso: string, days: number): string {
  return new Date(Date.parse(nowIso) - days * 86400000).toISOString();
}

function makeEvent(over: Partial<HealthRecordEvent> & { eventId: string }): HealthRecordEvent {
  return {
    childId: CHILD.childId,
    protocolId: 'growth-child-quarterly',
    groupId: 'growth',
    recordKind: 'manual',
    sourceSurface: 'profile_detail',
    recordedAt: NOW,
    effectiveDate: NOW,
    ageMonths: 115,
    recorderId: null,
    linkedReminderStateId: null,
    linkedReminderRuleId: null,
    notes: null,
    metadataJson: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  };
}

function makeValue(over: Partial<HealthRecordValue> & { valueId: string; eventId: string; metricId: HealthRecordValue['metricId'] }): HealthRecordValue {
  return {
    childId: CHILD.childId,
    valueNumber: 0,
    valueText: null,
    valueJson: null,
    unit: 'cm',
    qualifier: null,
    recordKind: 'measured',
    sourceValueIds: null,
    createdAt: NOW,
    ...over,
  };
}

function baseInput(over: Partial<GrowthDetailProjectionInput> = {}): GrowthDetailProjectionInput {
  return {
    child: CHILD,
    selectedMetricId: 'growth.height',
    growthStandard: 'china',
    events: [],
    values: [],
    whoDataset: null,
    page: 1,
    perPage: 10,
    filters: { dateRangeKey: 'all', sourceKey: 'all' },
    nowIso: NOW,
    ...over,
  };
}

function makeFlatWhoDataset(): WHOLMSDataset {
  const valueByPercentile: Record<number, number> = {
    3: 100,
    10: 105,
    25: 110,
    50: 115,
    75: 120,
    90: 125,
    97: 130,
  };
  return {
    typeId: 'height',
    gender: 'male',
    coverage: { startAgeMonths: 0, endAgeMonths: 240 },
    points: [],
    lines: [3, 10, 25, 50, 75, 90, 97].map((p) => ({
      percentile: p,
      points: Array.from({ length: 25 }, (_, i) => ({
        ageMonths: i * 12,
        value: valueByPercentile[p]!,
      })),
    })),
    standard: 'china',
  } as unknown as WHOLMSDataset;
}

// ---------------------------------------------------------------------------
// Empty data
// ---------------------------------------------------------------------------

describe('buildGrowthDetailSnapshot — empty data', () => {
  it('returns headline.state="no_data", all chips invisible, no milestones, unscheduled', () => {
    const snap = buildGrowthDetailSnapshot(baseInput());
    expect(snap.headline.state).toBe('no_data');
    expect(snap.crossMetric.every((chip) => chip.visible === false)).toBe(true);
    expect(snap.milestones).toEqual([]);
    expect(snap.nextCheck.state).toBe('unscheduled');
    expect(snap.historyPage.rows).toEqual([]);
    expect(snap.historyPage.total).toBe(0);
    expect(snap.recencyLabel).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Single metric data (height only)
// ---------------------------------------------------------------------------

describe('buildGrowthDetailSnapshot — single metric', () => {
  it('computes headline for height; only height chip visible', () => {
    const events = [
      makeEvent({ eventId: 'e1', effectiveDate: isoDaysBefore(NOW, 400), ageMonths: 103 }),
      makeEvent({ eventId: 'e2', effectiveDate: isoDaysBefore(NOW, 10), ageMonths: 115 }),
    ];
    const values = [
      makeValue({ valueId: 'v1', eventId: 'e1', metricId: 'growth.height', valueNumber: 132, unit: 'cm' }),
      makeValue({ valueId: 'v2', eventId: 'e2', metricId: 'growth.height', valueNumber: 140, unit: 'cm' }),
    ];
    const snap = buildGrowthDetailSnapshot(baseInput({ events, values }));
    expect(snap.headline.state).not.toBe('no_data');
    if (snap.headline.state === 'no_data') throw new Error('unexpected');
    expect(snap.headline.currentValueDisplay).toBe('140 cm');
    const heightChip = snap.crossMetric.find((c) => c.kind === 'height')!;
    expect(heightChip.visible).toBe(true);
    expect(heightChip.primary).toBe('140 cm');
    for (const otherKind of ['weight', 'bmi', 'head', 'bone_age'] as const) {
      expect(snap.crossMetric.find((c) => c.kind === otherKind)!.visible).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// Multi-metric data (height + weight → derived BMI chip surfaces)
// ---------------------------------------------------------------------------

describe('buildGrowthDetailSnapshot — multi-metric', () => {
  it('surfaces height, weight, AND derived BMI chips when both height+weight present', () => {
    const events = [
      makeEvent({ eventId: 'e1', effectiveDate: isoDaysBefore(NOW, 10), ageMonths: 115 }),
    ];
    const values = [
      makeValue({ valueId: 'v1', eventId: 'e1', metricId: 'growth.height', valueNumber: 140, unit: 'cm' }),
      makeValue({ valueId: 'v2', eventId: 'e1', metricId: 'growth.weight', valueNumber: 32, unit: 'kg' }),
    ];
    const snap = buildGrowthDetailSnapshot(baseInput({ events, values }));
    expect(snap.crossMetric.find((c) => c.kind === 'height')!.visible).toBe(true);
    expect(snap.crossMetric.find((c) => c.kind === 'weight')!.visible).toBe(true);
    expect(snap.crossMetric.find((c) => c.kind === 'bmi')!.visible).toBe(true);
    // head / bone_age remain hidden absent their own values
    expect(snap.crossMetric.find((c) => c.kind === 'head')!.visible).toBe(false);
    expect(snap.crossMetric.find((c) => c.kind === 'bone_age')!.visible).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Percentile boundary
// ---------------------------------------------------------------------------

describe('buildGrowthDetailSnapshot — percentile boundary', () => {
  const dataset = makeFlatWhoDataset();
  // Flat dataset: 100→P3, 105→P10, 110→P25, 115→P50, 120→P75, 125→P90, 130→P97.
  it.each([
    [100, 3],
    [105, 10],
    [115, 50],
    [125, 90],
    [130, 97],
  ])('value=%s cm at ageMonths=120 → percentile=%s', (value, expectedPercentile) => {
    const events = [
      makeEvent({ eventId: 'e1', effectiveDate: isoDaysBefore(NOW, 10), ageMonths: 120 }),
    ];
    const values = [
      makeValue({ valueId: 'v1', eventId: 'e1', metricId: 'growth.height', valueNumber: value, unit: 'cm' }),
    ];
    const snap = buildGrowthDetailSnapshot(baseInput({ events, values, whoDataset: dataset }));
    if (snap.headline.state === 'no_data') throw new Error('expected headline data');
    expect(snap.headline.currentPercentile).toBe(expectedPercentile);
  });
});

// ---------------------------------------------------------------------------
// Freshness boundary — nextCheck.state via buildHealthRecordSnapshot
// ---------------------------------------------------------------------------

describe('buildGrowthDetailSnapshot — freshness boundary', () => {
  it('emits nextCheck.state="scheduled" with non-null nextRecordAt when a latest record exists', () => {
    const events = [
      makeEvent({ eventId: 'e1', effectiveDate: isoDaysBefore(NOW, 30), ageMonths: 115 }),
    ];
    const values = [
      makeValue({ valueId: 'v1', eventId: 'e1', metricId: 'growth.height', valueNumber: 140, unit: 'cm' }),
    ];
    const snap = buildGrowthDetailSnapshot(baseInput({ events, values }));
    if (snap.nextCheck.state !== 'scheduled') {
      // unscheduled means the freshness policy didn't resolve a date; that
      // would mean the policy ref is misconfigured. In wave-A baseline the
      // policy DOES resolve so this branch should be reachable.
      throw new Error(`expected scheduled, got ${snap.nextCheck.state}`);
    }
    expect(snap.nextCheck.nextRecordAt).toBeTruthy();
    expect(typeof snap.nextCheck.daysFromNow).toBe('number');
    expect(['月度复测', '季度复测', '半年复测', '已逾期']).toContain(snap.nextCheck.badgeLabel);
  });

  it('emits nextCheck.state="unscheduled" when there is no latest record', () => {
    const snap = buildGrowthDetailSnapshot(baseInput());
    expect(snap.nextCheck.state).toBe('unscheduled');
  });
});

describe('resolveGrowthRecheckRuleId', () => {
  it('uses the next-stage growth rule at inclusive age boundaries', () => {
    expect(resolveGrowthRecheckRuleId(11)).toBe('PO-REM-GRO-001');
    expect(resolveGrowthRecheckRuleId(12)).toBe('PO-REM-GRO-002');
    expect(resolveGrowthRecheckRuleId(36)).toBe('PO-REM-GRO-003');
  });
});

// ---------------------------------------------------------------------------
// Milestone trigger boundary (just-under / at / just-over delegates to
// milestone-rules; here we cross-verify the projection plumbs them through)
// ---------------------------------------------------------------------------

describe('buildGrowthDetailSnapshot — milestone wiring', () => {
  it('plumbs threshold-crossed milestones through milestones[]', () => {
    const events = [
      makeEvent({ eventId: 'e1', effectiveDate: isoDaysBefore(NOW, 200), ageMonths: 108 }),
      makeEvent({ eventId: 'e2', effectiveDate: isoDaysBefore(NOW, 10), ageMonths: 115 }),
    ];
    const values = [
      makeValue({ valueId: 'v1', eventId: 'e1', metricId: 'growth.height', valueNumber: 139, unit: 'cm' }),
      makeValue({ valueId: 'v2', eventId: 'e2', metricId: 'growth.height', valueNumber: 141, unit: 'cm' }),
    ];
    const snap = buildGrowthDetailSnapshot(baseInput({ events, values }));
    expect(snap.milestones.length).toBeGreaterThan(0);
    expect(snap.milestones.some((m) => m.ruleId === 'growth-milestone-height-threshold-140cm')).toBe(true);
  });

  it('does NOT fire a 140cm threshold milestone when the value stays just under (139)', () => {
    const events = [
      makeEvent({ eventId: 'e1', effectiveDate: isoDaysBefore(NOW, 200), ageMonths: 108 }),
      makeEvent({ eventId: 'e2', effectiveDate: isoDaysBefore(NOW, 10), ageMonths: 115 }),
    ];
    const values = [
      makeValue({ valueId: 'v1', eventId: 'e1', metricId: 'growth.height', valueNumber: 138, unit: 'cm' }),
      makeValue({ valueId: 'v2', eventId: 'e2', metricId: 'growth.height', valueNumber: 139, unit: 'cm' }),
    ];
    const snap = buildGrowthDetailSnapshot(baseInput({ events, values }));
    expect(snap.milestones.some((m) => m.ruleId === 'growth-milestone-height-threshold-140cm')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// History pagination + filters
// ---------------------------------------------------------------------------

describe('buildGrowthDetailSnapshot — history pagination + filters', () => {
  function manyHeightRows(count: number, source: HealthRecordEvent['recordKind'] = 'manual') {
    const events: HealthRecordEvent[] = [];
    const values: HealthRecordValue[] = [];
    for (let i = 0; i < count; i++) {
      events.push(
        makeEvent({
          eventId: `e${i}`,
          effectiveDate: isoDaysBefore(NOW, i * 10),
          recordKind: source,
          ageMonths: 100 + Math.floor(i / 3),
        }),
      );
      values.push(
        makeValue({
          valueId: `v${i}`,
          eventId: `e${i}`,
          metricId: 'growth.height',
          valueNumber: 100 + i * 0.5,
          unit: 'cm',
        }),
      );
    }
    return { events, values };
  }

  it('paginates by page/perPage and reports total', () => {
    const { events, values } = manyHeightRows(25);
    const snap = buildGrowthDetailSnapshot(baseInput({ events, values, page: 2, perPage: 10 }));
    expect(snap.historyPage.rows).toHaveLength(10);
    expect(snap.historyPage.total).toBe(25);
    expect(snap.historyPage.page).toBe(2);
  });

  it('filters history by source key', () => {
    const a = manyHeightRows(5, 'manual');
    const b = manyHeightRows(3, 'ocr_confirmed');
    // Rename second batch to avoid id collision
    b.events.forEach((e, i) => (e.eventId = `o${i}`));
    b.values.forEach((v, i) => {
      v.valueId = `ov${i}`;
      v.eventId = `o${i}`;
    });
    const snap = buildGrowthDetailSnapshot(
      baseInput({
        events: [...a.events, ...b.events],
        values: [...a.values, ...b.values],
        filters: { dateRangeKey: 'all', sourceKey: 'ocr' },
        perPage: 50,
      }),
    );
    expect(snap.historyPage.rows.every((row) => row.source === 'ocr')).toBe(true);
    expect(snap.historyPage.total).toBe(3);
  });

  it('filters history by 3m date range', () => {
    const events: HealthRecordEvent[] = [
      makeEvent({ eventId: 'recent', effectiveDate: isoDaysBefore(NOW, 30) }),
      makeEvent({ eventId: 'old', effectiveDate: isoDaysBefore(NOW, 200) }),
    ];
    const values: HealthRecordValue[] = [
      makeValue({ valueId: 'vr', eventId: 'recent', metricId: 'growth.height', valueNumber: 140, unit: 'cm' }),
      makeValue({ valueId: 'vo', eventId: 'old', metricId: 'growth.height', valueNumber: 135, unit: 'cm' }),
    ];
    const snap = buildGrowthDetailSnapshot(
      baseInput({ events, values, filters: { dateRangeKey: '3m', sourceKey: 'all' } }),
    );
    expect(snap.historyPage.total).toBe(1);
    expect(snap.historyPage.rows[0]!.eventId).toBe('recent');
  });
});

// ---------------------------------------------------------------------------
// Determinism — same input twice → structurally equal snapshot including
// every milestoneId
// ---------------------------------------------------------------------------

describe('buildGrowthDetailSnapshot — determinism', () => {
  it('returns structurally identical snapshots for identical inputs (including milestoneId ULIDs)', () => {
    const events = [
      makeEvent({ eventId: 'e1', effectiveDate: isoDaysBefore(NOW, 300), ageMonths: 108 }),
      makeEvent({ eventId: 'e2', effectiveDate: isoDaysBefore(NOW, 200), ageMonths: 110 }),
      makeEvent({ eventId: 'e3', effectiveDate: isoDaysBefore(NOW, 10), ageMonths: 115 }),
    ];
    const values = [
      makeValue({ valueId: 'v1', eventId: 'e1', metricId: 'growth.height', valueNumber: 135, unit: 'cm' }),
      makeValue({ valueId: 'v2', eventId: 'e2', metricId: 'growth.height', valueNumber: 138, unit: 'cm' }),
      makeValue({ valueId: 'v3', eventId: 'e3', metricId: 'growth.height', valueNumber: 141, unit: 'cm' }),
      makeValue({ valueId: 'w1', eventId: 'e3', metricId: 'growth.weight', valueNumber: 32, unit: 'kg' }),
    ];
    const input = baseInput({ events, values });
    const a = buildGrowthDetailSnapshot(input);
    const b = buildGrowthDetailSnapshot(input);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.milestones.length).toBeGreaterThan(0);
    for (let i = 0; i < a.milestones.length; i++) {
      expect(a.milestones[i]!.milestoneId).toBe(b.milestones[i]!.milestoneId);
    }
  });

  it('produces no real Date.now() leakage — generatedAt always equals nowIso', () => {
    const snap = buildGrowthDetailSnapshot(baseInput());
    expect(snap.generatedAt).toBe(NOW);
  });
});

// ---------------------------------------------------------------------------
// Reference availability
// ---------------------------------------------------------------------------

describe('buildGrowthDetailSnapshot — reference', () => {
  it('reports datasetAvailable=false when whoDataset is null', () => {
    const snap = buildGrowthDetailSnapshot(baseInput());
    expect(snap.reference.datasetAvailable).toBe(false);
    expect(snap.reference.datasetCoverage).toBeNull();
  });

  it('reports datasetAvailable=true and coverage when whoDataset is provided', () => {
    const dataset = makeFlatWhoDataset();
    const snap = buildGrowthDetailSnapshot(baseInput({ whoDataset: dataset }));
    expect(snap.reference.datasetAvailable).toBe(true);
    expect(snap.reference.datasetCoverage).toEqual({ startAgeMonths: 0, endAgeMonths: 240 });
  });
});
