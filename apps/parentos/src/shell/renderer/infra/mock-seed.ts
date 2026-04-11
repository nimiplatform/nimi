/**
 * mock-seed.ts — Dev-only mock data import from mock.json into SQLite via bridge.
 */

import mockData from '../../../../mock.json';
import {
  dbInit,
  createFamily,
  createChild,
  getChildren,
  insertMeasurement,
  upsertMilestoneRecord,
  upsertReminderState,
  insertVaccineRecord,
  insertJournalEntry,
  insertJournalTag,
  createConversation,
  insertAiMessage,
  insertGrowthReport,
  setAppSetting,
  insertDentalRecord,
  insertAllergyRecord,
  upsertSleepRecord,
  insertMedicalEvent,
  insertTannerAssessment,
  insertFitnessAssessment,
} from '../bridge/sqlite-bridge.js';
import { mapChildRow } from '../bridge/mappers.js';
import { useAppStore } from '../app-shell/app-store.js';

type MockTables = typeof mockData.tables;

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

    // Measurements
    const n2 = await insertAll('measurements', tables.measurements, (r) =>
      insertMeasurement({ ...r, now: r.createdAt }), report);
    results.push(`measurements: ${n2}/${tables.measurements.length}`);

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
    const n9 = await insertAll('aiMessages', tables.aiMessages, (r) =>
      insertAiMessage({ ...r, now: r.createdAt }), report);
    results.push(`aiMessages: ${n9}/${tables.aiMessages.length}`);

    // Growth reports
    const n10 = await insertAll('reports', tables.growthReports, (r) =>
      insertGrowthReport({ ...r, now: r.createdAt }), report);
    results.push(`reports: ${n10}/${tables.growthReports.length}`);

    // App settings
    const n11 = await insertAll('settings', tables.appSettings, (r) =>
      setAppSetting(r.key, r.value, r.updatedAt), report);
    results.push(`settings: ${n11}/${tables.appSettings.length}`);

    // Dental records
    const n12 = await insertAll('dental', tables.dentalRecords, (r) =>
      insertDentalRecord({ ...r, now: r.createdAt }), report);
    results.push(`dental: ${n12}/${tables.dentalRecords.length}`);

    // Allergy records
    const n13 = await insertAll('allergies', tables.allergyRecords, (r) =>
      insertAllergyRecord({ ...r, now: r.createdAt }), report);
    results.push(`allergies: ${n13}/${tables.allergyRecords.length}`);

    // Sleep records
    const n14 = await insertAll('sleep', tables.sleepRecords, (r) =>
      upsertSleepRecord({ ...r, now: r.createdAt }), report);
    results.push(`sleep: ${n14}/${tables.sleepRecords.length}`);

    // Medical events
    const n15 = await insertAll('medical', tables.medicalEvents, (r) =>
      insertMedicalEvent({ ...r, now: r.createdAt }), report);
    results.push(`medical: ${n15}/${tables.medicalEvents.length}`);

    // Tanner assessments
    const n16 = await insertAll('tanner', tables.tannerAssessments, (r) =>
      insertTannerAssessment({ ...r, now: r.createdAt }), report);
    results.push(`tanner: ${n16}/${tables.tannerAssessments.length}`);

    // Fitness assessments
    const n17 = await insertAll('fitness', tables.fitnessAssessments, (r) =>
      insertFitnessAssessment({ ...r, now: r.createdAt }), report);
    results.push(`fitness: ${n17}/${tables.fitnessAssessments.length}`);

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
