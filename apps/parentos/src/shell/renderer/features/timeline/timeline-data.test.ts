import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChildProfile } from '../../app-shell/app-store.js';
import type { ActiveReminder, ReminderAgenda } from '../../engine/reminder-engine.js';
import type { DashData } from './timeline-data.js';
import {
  buildDataGapAlert,
  buildMilestoneTimeline,
  buildObservationDistribution,
  buildRecentChanges,
  buildSleepTrend,
  buildTimelineHomeViewModel,
} from './timeline-data.js';

function makeChild(overrides: Partial<ChildProfile> = {}): ChildProfile {
  return {
    childId: 'child-1',
    familyId: 'family-1',
    displayName: 'Mia',
    gender: 'female',
    birthDate: '2025-06-01',
    birthWeightKg: null,
    birthHeightCm: null,
    birthHeadCircCm: null,
    avatarPath: null,
    nurtureMode: 'balanced',
    nurtureModeOverrides: null,
    allergies: null,
    medicalNotes: null,
    recorderProfiles: null,
    createdAt: '2025-06-01T00:00:00.000Z',
    updatedAt: '2025-06-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeDash(overrides: Partial<DashData> = {}): DashData {
  return {
    reminderStates: [],
    measurements: [],
    vaccineRecords: [],
    vaccineCount: 0,
    milestoneRecords: [],
    journalEntries: [],
    sleepRecords: [],
    allergyRecords: [],
    customTodos: [],
    latestMonthlyReport: null,
    outdoorRecords: [],
    outdoorGoalMinutes: null,
    ...overrides,
  };
}

function makeAgenda(overrides: Partial<ReminderAgenda> = {}): ReminderAgenda {
  return {
    localToday: '2026-04-14',
    todayLimit: 3,
    todayFocus: [],
    p0Overflow: { count: 0, items: [] },
    onboardingCatchup: { count: 0, items: [] },
    upcoming: [],
    history: [],
    overdueSummary: { count: 0, items: [] },
    ...overrides,
  };
}

function makeReminder(domain: string): ActiveReminder {
  return {
    rule: {
      ruleId: `rule-${domain}`,
      domain,
      title: `${domain} reminder`,
      description: '',
      category: 'stage',
      triggerAge: { startMonths: 0, endMonths: 12 },
      priority: 'P1',
      nurtureMode: { relaxed: 'pull', balanced: 'pull', advanced: 'pull' },
      actionType: 'record_data',
    },
    visibility: 'pull',
    repeatIndex: 0,
    effectiveAgeMonths: 0,
    effectiveStartDate: '2026-04-14',
    effectiveEndDate: '2026-04-21',
    kind: 'task',
    lifecycle: 'due',
    status: 'active',
    overdueDays: 0,
    daysUntilStart: 0,
    daysUntilEnd: 7,
    deliveryDisposition: 'normal',
    state: null,
  } as unknown as ActiveReminder;
}

describe('timeline home view model helpers', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('picks recent changes by source priority, dedupes by domain, and caps at three items', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-14T10:00:00.000Z'));

    const child = makeChild();
    const changes = buildRecentChanges(
      makeDash({
        milestoneRecords: [
          { milestoneId: 'PO-MS-LANG-003', achievedAt: '2026-04-13T12:00:00.000Z' },
        ],
        vaccineRecords: [
          {
            recordId: 'vac-1',
            childId: child.childId,
            ruleId: 'rule-vac',
            vaccineName: 'Hepatitis B',
            vaccinatedAt: '2026-04-12T12:00:00.000Z',
            ageMonths: 10,
            batchNumber: null,
            hospital: null,
            adverseReaction: null,
            photoPath: null,
            createdAt: '2026-04-12T12:00:00.000Z',
          },
        ],
        measurements: [
          {
            measurementId: 'm-2',
            childId: child.childId,
            typeId: 'height',
            value: 82,
            measuredAt: '2026-04-11T08:00:00.000Z',
            ageMonths: 10,
            percentile: null,
            source: 'manual',
            notes: null,
            createdAt: '2026-04-11T08:00:00.000Z',
          },
          {
            measurementId: 'm-1',
            childId: child.childId,
            typeId: 'height',
            value: 80,
            measuredAt: '2026-03-20T08:00:00.000Z',
            ageMonths: 9,
            percentile: null,
            source: 'manual',
            notes: null,
            createdAt: '2026-03-20T08:00:00.000Z',
          },
        ],
        journalEntries: [
          {
            entryId: 'j-1',
            contentType: 'text',
            textContent: 'She put the blocks away on her own today.',
            recordedAt: '2026-04-14T08:00:00.000Z',
            observationMode: null,
            keepsake: 0,
            keepsakeTitle: null,
            keepsakeReason: null,
            dimensionId: null,
          },
        ],
      }),
      child,
      10,
    );

    expect(changes).toHaveLength(3);
    expect(changes.map((item) => item.domain)).toEqual(['milestone', 'vaccine', 'growth']);
  });

  it('describes measurement deltas when a previous record exists', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-14T10:00:00.000Z'));

    const child = makeChild();
    const changes = buildRecentChanges(
      makeDash({
        measurements: [
          {
            measurementId: 'w-2',
            childId: child.childId,
            typeId: 'weight',
            value: 12.4,
            measuredAt: '2026-04-13T08:00:00.000Z',
            ageMonths: 10,
            percentile: null,
            source: 'manual',
            notes: null,
            createdAt: '2026-04-13T08:00:00.000Z',
          },
          {
            measurementId: 'w-1',
            childId: child.childId,
            typeId: 'weight',
            value: 11.9,
            measuredAt: '2026-03-30T08:00:00.000Z',
            ageMonths: 9,
            percentile: null,
            source: 'manual',
            notes: null,
            createdAt: '2026-03-30T08:00:00.000Z',
          },
        ],
      }),
      child,
      10,
    );

    expect(changes[0]?.title).toBe('体重已更新');
    expect(changes[0]?.detail).toContain('与上次相比 +0.5 kg');
  });

  it('shows individual sleep records from the last 7 days', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-14T10:00:00.000Z'));

    const child = makeChild();
    const changes = buildRecentChanges(
      makeDash({
        sleepRecords: [
          '2026-04-14',
          '2026-04-13',
          '2026-04-12',
        ].map((sleepDate, index) => ({
          recordId: `sleep-${index}`,
          childId: child.childId,
          sleepDate,
          bedtime: '21:00',
          wakeTime: '07:00',
          durationMinutes: 600,
          napCount: null,
          napMinutes: null,
          quality: 'good',
          ageMonths: 10,
          notes: null,
          createdAt: `${sleepDate}T08:00:00.000Z`,
        })),
      }),
      child,
      10,
    );

    expect(changes).toHaveLength(1);
    expect(changes[0]?.domain).toBe('sleep');
    expect(changes[0]?.title).toBe('新增睡眠记录');
    expect(changes[0]?.detail).toContain('21:00 - 07:00');
    expect(changes[0]?.detail).toContain('10小时');
  });

  it('builds and suppresses data gap alerts based on freshness and visible reminders', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-14T10:00:00.000Z'));

    const child = makeChild();
    const staleDash = makeDash({
      measurements: [
        {
          measurementId: 'h-1',
          childId: child.childId,
          typeId: 'height',
          value: 82,
          measuredAt: '2025-12-01T08:00:00.000Z',
          ageMonths: 5,
          percentile: null,
          source: 'manual',
          notes: null,
          createdAt: '2025-12-01T08:00:00.000Z',
        },
      ],
    });

    const alert = buildDataGapAlert(staleDash, child, 10, 'balanced', makeAgenda());
    expect(alert?.id).toBe('growth_freshness_gap');

    const suppressed = buildDataGapAlert(
      staleDash,
      child,
      10,
      'relaxed',
      makeAgenda({ todayFocus: [makeReminder('growth')] }),
    );
    expect(suppressed).toBeNull();

    const missingBaseline = buildDataGapAlert(makeDash(), child, 6, 'balanced', makeAgenda());
    expect(missingBaseline?.id).toBe('growth_missing_baseline');
  });

  it('builds sleep trend with average duration and latest times', () => {
    const trend = buildSleepTrend([
      {
        recordId: 'sleep-1',
        childId: 'child-1',
        sleepDate: '2026-04-14',
        bedtime: '21:00',
        wakeTime: '07:00',
        durationMinutes: 600,
        napCount: null,
        napMinutes: null,
        quality: 'good',
        ageMonths: 10,
        notes: null,
        createdAt: '2026-04-14T08:00:00.000Z',
      },
      {
        recordId: 'sleep-2',
        childId: 'child-1',
        sleepDate: '2026-04-15',
        bedtime: '21:30',
        wakeTime: '06:30',
        durationMinutes: 540,
        napCount: null,
        napMinutes: null,
        quality: 'good',
        ageMonths: 10,
        notes: null,
        createdAt: '2026-04-15T08:00:00.000Z',
      },
    ]);

    expect(trend.totalRecords).toBe(2);
    expect(trend.points).toHaveLength(2);
    expect(trend.avgDurationMinutes).toBe(570);
    expect(trend.latestBedtime).toBe('21:30');
    expect(trend.latestWakeTime).toBe('06:30');
  });

  it('builds milestone timeline with recently achieved and upcoming items', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-16T10:00:00.000Z'));

    const timeline = buildMilestoneTimeline(
      [
        { milestoneId: 'PO-MS-GMOT-001', achievedAt: '2026-04-10T08:00:00.000Z' },
        { milestoneId: 'PO-MS-GMOT-002', achievedAt: '2026-03-20T08:00:00.000Z' },
      ],
      4,
    );

    expect(timeline.recentlyAchieved.length).toBeGreaterThan(0);
    expect(timeline.recentlyAchieved[0]?.milestoneId).toBe('PO-MS-GMOT-001');
    expect(timeline.upcoming.length).toBeGreaterThan(0);
    // All upcoming milestones should not be achieved yet
    const achievedIds = new Set(['PO-MS-GMOT-001', 'PO-MS-GMOT-002']);
    for (const item of timeline.upcoming) {
      expect(achievedIds.has(item.milestoneId)).toBe(false);
    }
  });

  it('builds observation dimension distribution from journal entries', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-16T10:00:00.000Z'));

    const dist = buildObservationDistribution([
      {
        entryId: 'j-1',
        contentType: 'text',
        textContent: 'Note 1',
        recordedAt: '2026-04-14T08:00:00.000Z',
        observationMode: null,
        keepsake: 0,
        keepsakeTitle: null,
        keepsakeReason: null,
        dimensionId: 'PO-OBS-MOVE-001',
      },
      {
        entryId: 'j-2',
        contentType: 'text',
        textContent: 'Note 2',
        recordedAt: '2026-04-13T08:00:00.000Z',
        observationMode: null,
        keepsake: 0,
        keepsakeTitle: null,
        keepsakeReason: null,
        dimensionId: 'PO-OBS-MOVE-001',
      },
      {
        entryId: 'j-3',
        contentType: 'text',
        textContent: 'Note 3',
        recordedAt: '2026-04-12T08:00:00.000Z',
        observationMode: null,
        keepsake: 0,
        keepsakeTitle: null,
        keepsakeReason: null,
        dimensionId: 'PO-OBS-LANG-001',
      },
      {
        entryId: 'j-4',
        contentType: 'text',
        textContent: 'No dimension',
        recordedAt: '2026-04-11T08:00:00.000Z',
        observationMode: null,
        keepsake: 0,
        keepsakeTitle: null,
        keepsakeReason: null,
        dimensionId: null,
      },
    ]);

    expect(dist.totalEntries).toBe(3);
    expect(dist.items).toHaveLength(2);
    expect(dist.items[0]?.dimensionId).toBe('PO-OBS-MOVE-001');
    expect(dist.items[0]?.count).toBe(2);
    expect(dist.items[1]?.dimensionId).toBe('PO-OBS-LANG-001');
    expect(dist.items[1]?.count).toBe(1);
  });

  it('builds full view model with new card data', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-16T10:00:00.000Z'));

    const child = makeChild();
    const homeVm = buildTimelineHomeViewModel({
      child,
      ageMonths: 10,
      d: makeDash({
        sleepRecords: [
          {
            recordId: 'sleep-1',
            childId: child.childId,
            sleepDate: '2026-04-16',
            bedtime: '21:00',
            wakeTime: '07:00',
            durationMinutes: 600,
            napCount: null,
            napMinutes: null,
            quality: 'good',
            ageMonths: 10,
            notes: null,
            createdAt: '2026-04-16T08:00:00.000Z',
          },
        ],
        milestoneRecords: [
          { milestoneId: 'PO-MS-GMOT-003', achievedAt: '2026-04-10T08:00:00.000Z' },
        ],
        journalEntries: [
          {
            entryId: 'j-1',
            contentType: 'text',
            textContent: 'Observation',
            recordedAt: '2026-04-14T08:00:00.000Z',
            observationMode: null,
            keepsake: 0,
            keepsakeTitle: null,
            keepsakeReason: null,
            dimensionId: 'PO-OBS-MOVE-001',
          },
        ],
      }),
      agenda: makeAgenda(),
    });

    expect(homeVm.sleepTrend.totalRecords).toBe(1);
    expect(homeVm.sleepTrend.avgDurationMinutes).toBe(600);
    expect(homeVm.milestoneTimeline.recentlyAchieved).toHaveLength(1);
    expect(homeVm.observationDistribution.totalEntries).toBe(1);
  });

  it('surfaces keepsake title and reason in recent journal summaries', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-16T10:00:00.000Z'));

    const child = makeChild();
    const homeVm = buildTimelineHomeViewModel({
      child,
      ageMonths: 10,
      d: makeDash({
        journalEntries: [
          {
            entryId: 'j-1',
            contentType: 'text',
            textContent: 'She finished a long picture book by herself.',
            recordedAt: '2026-04-15T08:00:00.000Z',
            observationMode: null,
            keepsake: 1,
            keepsakeTitle: '读完第一本桥梁书',
            keepsakeReason: 'achievement',
            dimensionId: null,
          },
        ],
      }),
      agenda: makeAgenda(),
    });

    expect(homeVm.recentChanges[0]?.label).toBe('珍藏');
    expect(homeVm.recentChanges[0]?.title).toBe('读完第一本桥梁书');
    expect(homeVm.recentChanges[0]?.detail).toContain('取得成果');
    expect(homeVm.recentChanges[0]?.to).toBe('/journal?filter=keepsake');
    expect(homeVm.recentLines[0]?.badge).toBe('珍藏');
    expect(homeVm.recentLines[0]?.badgeTone).toBe('keepsake');
    expect(homeVm.recentLines[0]?.tag).toBe('取得成果');
  });

});
