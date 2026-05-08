import { beforeEach, describe, expect, it, vi } from 'vitest';

import children from '../../../../mock/tables/children.json';
import dentalRecords from '../../../../mock/tables/dentalRecords.json';
import fitnessAssessments from '../../../../mock/tables/fitnessAssessments.json';
import measurements from '../../../../mock/tables/measurements.json';
import medicalEvents from '../../../../mock/tables/medicalEvents.json';
import sleepRecords from '../../../../mock/tables/sleepRecords.json';
import tannerAssessments from '../../../../mock/tables/tannerAssessments.json';
import { buildCanonicalHealthFixtureCaptures, seedMockData } from './mock-seed.js';

const bridgeMocks = vi.hoisted(() => ({
  createChild: vi.fn(),
  createConversation: vi.fn(),
  createFamily: vi.fn(),
  dbInit: vi.fn(),
  getChildren: vi.fn(),
  insertAiMessage: vi.fn(),
  insertAllergyRecord: vi.fn(),
  insertDentalRecord: vi.fn(),
  insertFitnessAssessment: vi.fn(),
  insertGrowthReport: vi.fn(),
  insertJournalEntry: vi.fn(),
  insertJournalTag: vi.fn(),
  insertMeasurement: vi.fn(),
  insertMedicalEvent: vi.fn(),
  insertTannerAssessment: vi.fn(),
  insertVaccineRecord: vi.fn(),
  saveHealthRecordCapture: vi.fn(),
  setAppSetting: vi.fn(),
  upsertMilestoneRecord: vi.fn(),
  upsertReminderState: vi.fn(),
  upsertSleepRecord: vi.fn(),
}));

const storeMocks = vi.hoisted(() => ({
  setActiveChildId: vi.fn(),
  setChildren: vi.fn(),
  setFamilyId: vi.fn(),
}));

vi.mock('../bridge/sqlite-bridge.js', () => bridgeMocks);

vi.mock('../bridge/mappers.js', () => ({
  mapChildRow: (row: unknown) => row,
}));

vi.mock('../app-shell/app-store.js', () => ({
  useAppStore: {
    getState: () => storeMocks,
  },
}));

describe('mock-seed health fixtures', () => {
  beforeEach(() => {
    for (const mock of Object.values(bridgeMocks)) {
      mock.mockReset();
      mock.mockResolvedValue(undefined);
    }
    for (const mock of Object.values(storeMocks)) {
      mock.mockReset();
    }
    bridgeMocks.getChildren.mockResolvedValue([]);
  });

  it('converts folded health fixtures into canonical event/value captures', () => {
    const captures = buildCanonicalHealthFixtureCaptures({
      children,
      dentalRecords,
      fitnessAssessments,
      measurements,
      medicalEvents,
      sleepRecords,
      tannerAssessments,
    });
    const metricIds = new Set(captures.flatMap((capture) => capture.values.map((value) => value.metricId)));
    const sourceTables = new Set(captures.map((capture) => {
      const metadata = capture.metadataJson ? JSON.parse(capture.metadataJson) : {};
      return metadata.fixtureSourceTable;
    }));

    expect(sourceTables).toEqual(new Set([
      'measurements',
      'sleepRecords',
      'dentalRecords',
      'medicalEvents',
      'tannerAssessments',
      'fitnessAssessments',
    ]));
    expect(metricIds).toContain('growth.height');
    expect(metricIds).toContain('sleep.duration_minutes');
    expect(metricIds).toContain('dental.event');
    expect(metricIds).toContain('medical.event');
    expect(metricIds).toContain('development.tanner_breast_stage');
    expect(metricIds).toContain('fitness.foot_arch_status');
  });

  it('seeds canonical health records instead of current folded health tables', async () => {
    const result = await seedMockData();

    expect(result.ok).toBe(true);
    expect(result.summary).toContain('healthRecords:');
    expect(result.summary).not.toContain('measurements:');
    expect(result.summary).not.toContain('dental:');
    expect(result.summary).not.toContain('sleep:');
    expect(result.summary).not.toContain('medical:');
    expect(result.summary).not.toContain('tanner:');
    expect(result.summary).not.toContain('fitness:');
    expect(bridgeMocks.saveHealthRecordCapture).toHaveBeenCalled();
    expect(bridgeMocks.insertMeasurement).not.toHaveBeenCalled();
    expect(bridgeMocks.insertDentalRecord).not.toHaveBeenCalled();
    expect(bridgeMocks.upsertSleepRecord).not.toHaveBeenCalled();
    expect(bridgeMocks.insertMedicalEvent).not.toHaveBeenCalled();
    expect(bridgeMocks.insertTannerAssessment).not.toHaveBeenCalled();
    expect(bridgeMocks.insertFitnessAssessment).not.toHaveBeenCalled();
  });
});
