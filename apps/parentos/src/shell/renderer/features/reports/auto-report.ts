import type { ChildProfile } from '../../app-shell/app-store.js';
import {
  getAllergyRecords, getDentalRecords, getFitnessAssessments, getGrowthReports,
  getJournalEntries, getMeasurements, getMedicalEvents, getMilestoneRecords,
  getReminderStates, getSleepRecords, getTannerAssessments, getVaccineRecords,
  insertGrowthReport,
} from '../../bridge/sqlite-bridge.js';
import { isoNow, ulid } from '../../bridge/ulid.js';
import { generateNarrativeReport } from './narrative-prompt.js';

function currentMonthBounds(): { start: string; end: string } {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  const pad = (n: number) => String(n).padStart(2, '0');
  return { start: `${y}-${pad(m + 1)}-01T00:00:00.000Z`, end: now.toISOString() };
}

export async function autoGenerateMonthlyReport(child: ChildProfile): Promise<string | null> {
  let runtime;
  try {
    const { getPlatformClient } = await import('@nimiplatform/sdk');
    const client = getPlatformClient();
    if (!client.runtime?.appId) return null;
    runtime = client.runtime;
  } catch { return null; }

  const { start } = currentMonthBounds();
  const existing = await getGrowthReports(child.childId);
  if (existing.some((r) => r.periodStart >= start)) return null;

  const now = isoNow();
  const bounds = currentMonthBounds();

  const [measurements, milestones, vaccines, journalEntries, reminderStates, sleepRecords,
    dentalRecords, allergyRecords, medicalEvents, fitnessAssessments, tannerAssessments] = await Promise.all([
    getMeasurements(child.childId), getMilestoneRecords(child.childId),
    getVaccineRecords(child.childId), getJournalEntries(child.childId, 200),
    getReminderStates(child.childId), getSleepRecords(child.childId),
    getDentalRecords(child.childId), getAllergyRecords(child.childId),
    getMedicalEvents(child.childId), getFitnessAssessments(child.childId),
    getTannerAssessments(child.childId),
  ]);

  const report = await generateNarrativeReport(
    child, { start: bounds.start, end: bounds.end },
    { measurements, milestones, vaccines, journalEntries, reminderStates, sleepRecords, dentalRecords, allergyRecords, medicalEvents, fitnessAssessments, tannerAssessments },
    runtime,
  );

  const reportId = ulid();
  await insertGrowthReport({
    reportId, childId: child.childId, reportType: report.reportType,
    periodStart: report.periodStart, periodEnd: report.periodEnd,
    ageMonthsStart: report.ageMonthsStart, ageMonthsEnd: report.ageMonthsEnd,
    content: JSON.stringify(report.content), generatedAt: now, now,
  });

  return reportId;
}
