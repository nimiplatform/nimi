/**
 * mock-seed.ts — Dev-only mock data import from split JSON fixtures into SQLite via bridge.
 */

import mockCore from '../../../../mock/core.json';
import allergyRecords from '../../../../mock/tables/allergyRecords.json';
import aiMessages from '../../../../mock/tables/aiMessages.json';
import appSettings from '../../../../mock/tables/appSettings.json';
import children from '../../../../mock/tables/children.json';
import conversations from '../../../../mock/tables/conversations.json';
import dentalRecords from '../../../../mock/tables/dentalRecords.json';
import fitnessAssessments from '../../../../mock/tables/fitnessAssessments.json';
import growthReports from '../../../../mock/tables/growthReports.json';
import journalEntries from '../../../../mock/tables/journalEntries.json';
import journalTags from '../../../../mock/tables/journalTags.json';
import measurements from '../../../../mock/tables/measurements.json';
import medicalEvents from '../../../../mock/tables/medicalEvents.json';
import milestoneRecords from '../../../../mock/tables/milestoneRecords.json';
import reminderStates from '../../../../mock/tables/reminderStates.json';
import sleepRecords from '../../../../mock/tables/sleepRecords.json';
import tannerAssessments from '../../../../mock/tables/tannerAssessments.json';
import vaccineRecords from '../../../../mock/tables/vaccineRecords.json';
import {
  dbInit,
  createFamily,
  createChild,
  getChildren,
  upsertMilestoneRecord,
  upsertReminderState,
  insertVaccineRecord,
  insertJournalEntry,
  insertJournalTag,
  createConversation,
  insertAiMessage,
  insertGrowthReport,
  setAppSetting,
  insertAllergyRecord,
  saveHealthRecordCapture,
} from '../bridge/sqlite-bridge.js';
import { mapChildRow } from '../bridge/mappers.js';
import { useAppStore } from '../app-shell/app-store.js';
import type { SaveHealthRecordCaptureInput } from '../bridge/sqlite-bridge.js';

const mockData = {
  ...mockCore,
  tables: {
    allergyRecords,
    aiMessages,
    appSettings,
    children,
    conversations,
    growthReports,
    journalEntries,
    journalTags,
    milestoneRecords,
    reminderStates,
    vaccineRecords,
  },
};

type MockTables = typeof mockData.tables;
type MockAiMessage = {
  messageId: string;
  conversationId: string;
  role: string;
  content: string;
  contextSnapshot: string | null;
  createdAt: string;
};
type MockHealthFixtures = {
  children: typeof children;
  dentalRecords: typeof dentalRecords;
  fitnessAssessments: typeof fitnessAssessments;
  measurements: typeof measurements;
  medicalEvents: typeof medicalEvents;
  sleepRecords: typeof sleepRecords;
  tannerAssessments: typeof tannerAssessments;
};

type HealthRecordCaptureValue = SaveHealthRecordCaptureInput['values'][number];

const measurementMap: Record<
  string,
  {
    metricId: string;
    protocolId: string;
    groupId: string;
    unit: string | null;
    qualifier: string | null;
  }
> = {
  height: {
    metricId: 'growth.height',
    protocolId: 'growth-child-quarterly',
    groupId: 'growth',
    unit: 'cm',
    qualifier: null,
  },
  weight: {
    metricId: 'growth.weight',
    protocolId: 'growth-child-quarterly',
    groupId: 'growth',
    unit: 'kg',
    qualifier: null,
  },
  'head-circumference': {
    metricId: 'growth.head_circumference',
    protocolId: 'growth-infant-monthly',
    groupId: 'growth',
    unit: 'cm',
    qualifier: null,
  },
  'vision-left': {
    metricId: 'vision.left_visual_acuity',
    protocolId: 'vision-basic',
    groupId: 'vision',
    unit: 'decimal',
    qualifier: 'left',
  },
  'vision-right': {
    metricId: 'vision.right_visual_acuity',
    protocolId: 'vision-basic',
    groupId: 'vision',
    unit: 'decimal',
    qualifier: 'right',
  },
  'axial-length-left': {
    metricId: 'vision.left_axial_length',
    protocolId: 'vision-full-exam',
    groupId: 'vision',
    unit: 'mm',
    qualifier: 'left',
  },
  'axial-length-right': {
    metricId: 'vision.right_axial_length',
    protocolId: 'vision-full-exam',
    groupId: 'vision',
    unit: 'mm',
    qualifier: 'right',
  },
  'iop-left': {
    metricId: 'vision.left_iop',
    protocolId: 'vision-full-exam',
    groupId: 'vision',
    unit: 'mmHg',
    qualifier: 'left',
  },
  'iop-right': {
    metricId: 'vision.right_iop',
    protocolId: 'vision-full-exam',
    groupId: 'vision',
    unit: 'mmHg',
    qualifier: 'right',
  },
  'bone-age': {
    metricId: 'development.bone_age_years',
    protocolId: 'development-auxiliary-measurement',
    groupId: 'development',
    unit: 'years',
    qualifier: null,
  },
  'body-fat-percentage': {
    metricId: 'development.body_fat_percentage',
    protocolId: 'development-auxiliary-measurement',
    groupId: 'development',
    unit: 'percent',
    qualifier: null,
  },
};

const fitnessValueMap: Record<
  string,
  {
    metricId: string;
    unit: string | null;
    valueField: keyof (typeof fitnessAssessments)[number];
    valueKind: 'number' | 'text';
  }
> = {
  run50m: { metricId: 'fitness.run_50m', unit: 's', valueField: 'run50m', valueKind: 'number' },
  run800m: { metricId: 'fitness.run_800m', unit: 's', valueField: 'run800m', valueKind: 'number' },
  run1000m: { metricId: 'fitness.run_1000m', unit: 's', valueField: 'run1000m', valueKind: 'number' },
  run50x8: { metricId: 'fitness.run_50x8', unit: 's', valueField: 'run50x8', valueKind: 'number' },
  sitAndReach: { metricId: 'fitness.sit_and_reach', unit: 'cm', valueField: 'sitAndReach', valueKind: 'number' },
  standingLongJump: {
    metricId: 'fitness.standing_long_jump',
    unit: 'cm',
    valueField: 'standingLongJump',
    valueKind: 'number',
  },
  sitUps: { metricId: 'fitness.sit_ups', unit: 'count', valueField: 'sitUps', valueKind: 'number' },
  pullUps: { metricId: 'fitness.pull_ups', unit: 'count', valueField: 'pullUps', valueKind: 'number' },
  ropeSkipping: {
    metricId: 'fitness.rope_skipping',
    unit: 'count_per_min',
    valueField: 'ropeSkipping',
    valueKind: 'number',
  },
  vitalCapacity: {
    metricId: 'fitness.vital_capacity',
    unit: 'ml',
    valueField: 'vitalCapacity',
    valueKind: 'number',
  },
  run10mShuttle: {
    metricId: 'fitness.run_10m_shuttle',
    unit: 's',
    valueField: 'run10mShuttle',
    valueKind: 'number',
  },
  tennisBallThrow: {
    metricId: 'fitness.tennis_ball_throw',
    unit: 'm',
    valueField: 'tennisBallThrow',
    valueKind: 'number',
  },
  doubleFootJump: {
    metricId: 'fitness.double_foot_jump',
    unit: 's',
    valueField: 'doubleFootJump',
    valueKind: 'number',
  },
  balanceBeam: {
    metricId: 'fitness.balance_beam',
    unit: 's',
    valueField: 'balanceBeam',
    valueKind: 'number',
  },
  footArchStatus: {
    metricId: 'fitness.foot_arch_status',
    unit: null,
    valueField: 'footArchStatus',
    valueKind: 'text',
  },
};

function eventKindForFixtureSource(source: string | null | undefined): SaveHealthRecordCaptureInput['recordKind'] {
  if (source === 'ocr') return 'ocr_confirmed';
  if (source === 'imported') return 'imported';
  return 'manual';
}

function sourceSurfaceForFixtureSource(source: string | null | undefined): SaveHealthRecordCaptureInput['sourceSurface'] {
  if (source === 'ocr') return 'ocr_tool';
  if (source === 'imported') return 'import';
  return 'profile_detail';
}

function numberValue(input: {
  valueId: string;
  metricId: string;
  value: number;
  unit: string | null;
  qualifier?: string | null;
}): HealthRecordCaptureValue {
  return {
    valueId: input.valueId,
    metricId: input.metricId,
    valueNumber: input.value,
    valueText: null,
    valueJson: null,
    unit: input.unit,
    qualifier: input.qualifier ?? null,
    recordKind: 'measured',
    sourceValueIds: null,
  };
}

function textValue(input: {
  valueId: string;
  metricId: string;
  value: string;
  unit?: string | null;
}): HealthRecordCaptureValue {
  return {
    valueId: input.valueId,
    metricId: input.metricId,
    valueNumber: null,
    valueText: input.value,
    valueJson: null,
    unit: input.unit ?? null,
    qualifier: null,
    recordKind: 'measured',
    sourceValueIds: null,
  };
}

function jsonValue(input: {
  valueId: string;
  metricId: string;
  value: unknown;
}): HealthRecordCaptureValue {
  return {
    valueId: input.valueId,
    metricId: input.metricId,
    valueNumber: null,
    valueText: null,
    valueJson: JSON.stringify(input.value),
    unit: null,
    qualifier: null,
    recordKind: 'measured',
    sourceValueIds: null,
  };
}

export function buildCanonicalHealthFixtureCaptures(fixtures: MockHealthFixtures): SaveHealthRecordCaptureInput[] {
  const childGender = new Map(fixtures.children.map((child) => [child.childId, child.gender]));
  const captures: SaveHealthRecordCaptureInput[] = [];

  for (const row of fixtures.measurements) {
    const mapping = measurementMap[row.typeId];
    if (!mapping || !Number.isFinite(row.value)) continue;
    const eventId = `fixture-measurement:${row.measurementId}`;
    captures.push({
      eventId,
      childId: row.childId,
      protocolId: mapping.protocolId,
      groupId: mapping.groupId,
      recordKind: eventKindForFixtureSource(row.source),
      sourceSurface: sourceSurfaceForFixtureSource(row.source),
      recordedAt: row.measuredAt,
      effectiveDate: row.measuredAt.slice(0, 10),
      ageMonths: row.ageMonths,
      recorderId: null,
      linkedReminderStateId: null,
      linkedReminderRuleId: null,
      notes: row.notes,
      metadataJson: JSON.stringify({
        fixtureSourceTable: 'measurements',
        fixtureSourceId: row.measurementId,
        legacyTypeId: row.typeId,
        percentile: row.percentile,
      }),
      now: row.createdAt,
      values: [
        numberValue({
          valueId: `fixture-measurement-value:${row.measurementId}`,
          metricId: mapping.metricId,
          value: row.value,
          unit: mapping.unit,
          qualifier: mapping.qualifier,
        }),
      ],
    });
  }

  for (const row of fixtures.sleepRecords) {
    if (!Number.isFinite(row.durationMinutes) || row.durationMinutes <= 0) continue;
    captures.push({
      eventId: `fixture-sleep:${row.recordId}`,
      childId: row.childId,
      protocolId: 'sleep-night',
      groupId: 'sleep',
      recordKind: 'manual',
      sourceSurface: 'profile_detail',
      recordedAt: row.sleepDate,
      effectiveDate: row.sleepDate,
      ageMonths: row.ageMonths,
      recorderId: null,
      linkedReminderStateId: null,
      linkedReminderRuleId: null,
      notes: row.notes,
      metadataJson: JSON.stringify({
        fixtureSourceTable: 'sleepRecords',
        fixtureSourceId: row.recordId,
        bedtime: row.bedtime,
        wakeTime: row.wakeTime,
        napCount: row.napCount,
        napMinutes: row.napMinutes,
        quality: row.quality,
      }),
      now: row.createdAt,
      values: [
        numberValue({
          valueId: `fixture-sleep-value:${row.recordId}`,
          metricId: 'sleep.duration_minutes',
          value: row.durationMinutes,
          unit: 'min',
        }),
      ],
    });
  }

  for (const row of fixtures.dentalRecords) {
    captures.push({
      eventId: `fixture-dental:${row.recordId}`,
      childId: row.childId,
      protocolId: 'dental-event',
      groupId: 'dental',
      recordKind: 'manual',
      sourceSurface: 'profile_detail',
      recordedAt: row.eventDate,
      effectiveDate: row.eventDate,
      ageMonths: row.ageMonths,
      recorderId: null,
      linkedReminderStateId: null,
      linkedReminderRuleId: null,
      notes: row.notes,
      metadataJson: JSON.stringify({
        fixtureSourceTable: 'dentalRecords',
        fixtureSourceId: row.recordId,
        eventType: row.eventType,
      }),
      now: row.createdAt,
      values: [
        jsonValue({
          valueId: `fixture-dental-value:${row.recordId}`,
          metricId: 'dental.event',
          value: {
            eventType: row.eventType,
            toothId: row.toothId,
            toothSet: row.toothSet,
            severity: row.severity,
            hospital: row.hospital,
            photoPath: row.photoPath,
          },
        }),
      ],
    });
  }

  for (const row of fixtures.medicalEvents) {
    captures.push({
      eventId: `fixture-medical:${row.eventId}`,
      childId: row.childId,
      protocolId: 'medical-event',
      groupId: 'medical',
      recordKind: 'manual',
      sourceSurface: 'profile_detail',
      recordedAt: row.eventDate,
      effectiveDate: row.eventDate,
      ageMonths: row.ageMonths,
      recorderId: null,
      linkedReminderStateId: null,
      linkedReminderRuleId: null,
      notes: row.notes,
      metadataJson: JSON.stringify({
        fixtureSourceTable: 'medicalEvents',
        fixtureSourceId: row.eventId,
        eventType: row.eventType,
      }),
      now: row.updatedAt,
      values: [
        jsonValue({
          valueId: `fixture-medical-value:${row.eventId}`,
          metricId: 'medical.event',
          value: {
            eventType: row.eventType,
            title: row.title,
            endDate: row.endDate,
            severity: row.severity,
            result: row.result,
            hospital: row.hospital,
            medication: row.medication,
            dosage: row.dosage,
            photoPath: row.photoPath,
          },
        }),
      ],
    });
  }

  for (const row of fixtures.tannerAssessments) {
    const gender = childGender.get(row.childId);
    const values: HealthRecordCaptureValue[] = [];
    if (row.breastOrGenitalStage != null) {
      values.push(
        numberValue({
          valueId: `fixture-tanner-value:${row.assessmentId}:primary`,
          metricId: gender === 'male'
            ? 'development.tanner_genital_stage'
            : 'development.tanner_breast_stage',
          value: row.breastOrGenitalStage,
          unit: 'stage',
        }),
      );
    }
    if (row.pubicHairStage != null) {
      values.push(
        numberValue({
          valueId: `fixture-tanner-value:${row.assessmentId}:pubic-hair`,
          metricId: 'development.tanner_pubic_hair_stage',
          value: row.pubicHairStage,
          unit: 'stage',
        }),
      );
    }
    if (values.length === 0) continue;
    captures.push({
      eventId: `fixture-tanner:${row.assessmentId}`,
      childId: row.childId,
      protocolId: gender === 'male' ? 'tanner-male-self-assessment' : 'tanner-female-self-assessment',
      groupId: 'development',
      recordKind: 'manual',
      sourceSurface: 'profile_detail',
      recordedAt: row.assessedAt,
      effectiveDate: row.assessedAt.slice(0, 10),
      ageMonths: row.ageMonths,
      recorderId: null,
      linkedReminderStateId: null,
      linkedReminderRuleId: null,
      notes: row.notes,
      metadataJson: JSON.stringify({
        fixtureSourceTable: 'tannerAssessments',
        fixtureSourceId: row.assessmentId,
        assessedBy: row.assessedBy,
      }),
      now: row.createdAt,
      values,
    });
  }

  for (const row of fixtures.fitnessAssessments) {
    const values: HealthRecordCaptureValue[] = [];
    for (const [sourceField, mapping] of Object.entries(fitnessValueMap)) {
      const sourceValue = row[mapping.valueField];
      if (sourceValue == null) continue;
      if (mapping.valueKind === 'number') {
        if (typeof sourceValue !== 'number' || !Number.isFinite(sourceValue)) continue;
        values.push(
          numberValue({
            valueId: `fixture-fitness-value:${row.assessmentId}:${sourceField}`,
            metricId: mapping.metricId,
            value: sourceValue,
            unit: mapping.unit,
          }),
        );
      } else if (typeof sourceValue === 'string' && sourceValue.trim() !== '') {
        values.push(
          textValue({
            valueId: `fixture-fitness-value:${row.assessmentId}:${sourceField}`,
            metricId: mapping.metricId,
            value: sourceValue,
            unit: mapping.unit,
          }),
        );
      }
    }
    if (values.length === 0) continue;
    captures.push({
      eventId: `fixture-fitness:${row.assessmentId}`,
      childId: row.childId,
      protocolId: 'fitness-school-assessment',
      groupId: 'fitness',
      recordKind: 'manual',
      sourceSurface: 'profile_detail',
      recordedAt: row.assessedAt,
      effectiveDate: row.assessedAt.slice(0, 10),
      ageMonths: row.ageMonths,
      recorderId: null,
      linkedReminderStateId: null,
      linkedReminderRuleId: null,
      notes: row.notes,
      metadataJson: JSON.stringify({
        fixtureSourceTable: 'fitnessAssessments',
        fixtureSourceId: row.assessmentId,
        assessmentSource: row.assessmentSource,
      }),
      now: row.createdAt,
      values,
    });
  }

  return captures;
}

async function insertAll<T>(
  label: string,
  rows: T[],
  fn: (row: T) => Promise<void>,
  onProgress?: (label: string, done: number, total: number) => void,
): Promise<number> {
  let ok = 0;
  for (const row of rows) {
    try {
      await fn(row);
      ok++;
    } catch {
      // skip duplicates (UNIQUE constraint) on re-import
    }
    onProgress?.(label, ok, rows.length);
  }
  return ok;
}

export type SeedProgress = { label: string; done: number; total: number };

export async function seedMockData(
  onProgress?: (p: SeedProgress) => void,
): Promise<{ ok: boolean; summary: string }> {
  const report = (label: string, done: number, total: number) =>
    onProgress?.({ label, done, total });
  const tables: MockTables = mockData.tables;
  const family = mockData.family;
  const results: string[] = [];

  try {
    await dbInit();

    // Family
    try {
      await createFamily(family.familyId, family.displayName, family.createdAt);
      results.push('family: 1');
    } catch {
      results.push('family: exists');
    }

    // Children
    const n1 = await insertAll('children', tables.children, (r) =>
      createChild({ ...r, now: r.createdAt }), report);
    results.push(`children: ${n1}/${tables.children.length}`);

    // Canonical health records
    const healthFixtures = buildCanonicalHealthFixtureCaptures({
      children: tables.children,
      dentalRecords,
      fitnessAssessments,
      measurements,
      medicalEvents,
      sleepRecords,
      tannerAssessments,
    });
    const n2 = await insertAll('healthRecords', healthFixtures, (r) =>
      saveHealthRecordCapture(r).then(() => undefined), report);
    results.push(`healthRecords: ${n2}/${healthFixtures.length}`);

    // Milestones
    const n3 = await insertAll('milestones', tables.milestoneRecords, (r) =>
      upsertMilestoneRecord({ ...r, now: r.createdAt }), report);
    results.push(`milestones: ${n3}/${tables.milestoneRecords.length}`);

    // Reminder states
    const n4 = await insertAll('reminders', tables.reminderStates, (r) =>
      upsertReminderState({ ...r, now: r.createdAt }), report);
    results.push(`reminders: ${n4}/${tables.reminderStates.length}`);

    // Vaccines
    const n5 = await insertAll('vaccines', tables.vaccineRecords, (r) =>
      insertVaccineRecord({ ...r, now: r.createdAt }), report);
    results.push(`vaccines: ${n5}/${tables.vaccineRecords.length}`);

    // Journal entries
    const n6 = await insertAll('journal', tables.journalEntries, (r) =>
      insertJournalEntry({ ...r, now: r.createdAt }), report);
    results.push(`journal: ${n6}/${tables.journalEntries.length}`);

    // Journal tags
    const n7 = await insertAll('tags', tables.journalTags, (r) =>
      insertJournalTag({ ...r, now: r.createdAt }), report);
    results.push(`tags: ${n7}/${tables.journalTags.length}`);

    // Conversations
    const n8 = await insertAll('conversations', tables.conversations, (r) =>
      createConversation({ ...r, now: r.createdAt }), report);
    results.push(`conversations: ${n8}/${tables.conversations.length}`);

    // AI messages
    const aiMessageFixtures = tables.aiMessages as MockAiMessage[];
    const n9 = await insertAll('aiMessages', aiMessageFixtures, (r) =>
      insertAiMessage({ ...r, now: r.createdAt }), report);
    results.push(`aiMessages: ${n9}/${aiMessageFixtures.length}`);

    // Growth reports
    const n10 = await insertAll('reports', tables.growthReports, (r) =>
      insertGrowthReport({ ...r, now: r.createdAt }), report);
    results.push(`reports: ${n10}/${tables.growthReports.length}`);

    // App settings
    const n11 = await insertAll('settings', tables.appSettings, (r) =>
      setAppSetting(r.key, r.value, r.updatedAt), report);
    results.push(`settings: ${n11}/${tables.appSettings.length}`);

    // Allergy records
    const n12 = await insertAll('allergies', tables.allergyRecords, (r) =>
      insertAllergyRecord({ ...r, now: r.createdAt }), report);
    results.push(`allergies: ${n12}/${tables.allergyRecords.length}`);

    // Refresh Zustand store
    const store = useAppStore.getState();
    store.setFamilyId(family.familyId);
    const rows = await getChildren(family.familyId);
    const children = rows.map(mapChildRow);
    store.setChildren(children);
    if (children.length > 0) {
      store.setActiveChildId(mockData.appState.activeChildId || children[0]!.childId);
    }

    return { ok: true, summary: results.join(' | ') };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return { ok: false, summary: `Failed: ${msg}\n${results.join(' | ')}` };
  }
}
