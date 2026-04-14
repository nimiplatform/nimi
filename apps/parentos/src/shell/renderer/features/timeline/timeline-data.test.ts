import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChildProfile } from '../../app-shell/app-store.js';
import type { ActiveReminder, ReminderAgenda } from '../../engine/reminder-engine.js';
import type { DashData } from './timeline-data.js';
import { buildDataGapAlert, buildRecentChanges } from './timeline-data.js';

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
    latestMonthlyReport: null,
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
    thisWeek: [],
    stageFocus: [],
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
});
