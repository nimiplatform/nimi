import { invoke } from '@tauri-apps/api/core';

export interface MeasurementRow {
  measurementId: string;
  childId: string;
  typeId: string;
  value: number;
  measuredAt: string;
  ageMonths: number;
  percentile: number | null;
  source: string | null;
  notes: string | null;
  createdAt: string;
}

export function insertMeasurement(params: {
  measurementId: string;
  childId: string;
  typeId: string;
  value: number;
  measuredAt: string;
  ageMonths: number;
  percentile: number | null;
  source: string | null;
  notes: string | null;
  now: string;
}) {
  return invoke<void>('insert_measurement', params);
}

export function getMeasurements(childId: string, typeId?: string) {
  return invoke<MeasurementRow[]>('get_measurements', { childId, typeId: typeId ?? null });
}

export function updateMeasurement(params: {
  measurementId: string;
  value: number;
  measuredAt: string;
  ageMonths: number;
  percentile: number | null;
  source: string | null;
  notes: string | null;
  now: string;
}) {
  return invoke<void>('update_measurement', params);
}

export function deleteMeasurement(measurementId: string) {
  return invoke<void>('delete_measurement', { measurementId });
}

export interface MilestoneRecordRow {
  recordId: string;
  childId: string;
  milestoneId: string;
  achievedAt: string | null;
  ageMonthsWhenAchieved: number | null;
  notes: string | null;
  photoPath: string | null;
  createdAt: string;
  updatedAt: string;
}

export function upsertMilestoneRecord(params: {
  recordId: string;
  childId: string;
  milestoneId: string;
  achievedAt: string | null;
  ageMonthsWhenAchieved: number | null;
  notes: string | null;
  photoPath: string | null;
  now: string;
}) {
  return invoke<void>('upsert_milestone_record', params);
}

export function getMilestoneRecords(childId: string) {
  return invoke<MilestoneRecordRow[]>('get_milestone_records', { childId });
}

export interface VaccineRecordRow {
  recordId: string;
  childId: string;
  ruleId: string;
  vaccineName: string;
  vaccinatedAt: string;
  ageMonths: number;
  batchNumber: string | null;
  hospital: string | null;
  adverseReaction: string | null;
  photoPath: string | null;
  createdAt: string;
}

export function insertVaccineRecord(params: {
  recordId: string;
  childId: string;
  ruleId: string;
  vaccineName: string;
  vaccinatedAt: string;
  ageMonths: number;
  batchNumber: string | null;
  hospital: string | null;
  adverseReaction: string | null;
  photoPath: string | null;
  now: string;
}) {
  return invoke<void>('insert_vaccine_record', params);
}

export function getVaccineRecords(childId: string) {
  return invoke<VaccineRecordRow[]>('get_vaccine_records', { childId });
}

export function insertGrowthReport(params: {
  reportId: string;
  childId: string;
  reportType: string;
  periodStart: string;
  periodEnd: string;
  ageMonthsStart: number;
  ageMonthsEnd: number;
  content: string;
  generatedAt: string;
  now: string;
}) {
  return invoke<void>('insert_growth_report', params);
}

export function getGrowthReports(childId: string, reportType?: string) {
  return invoke<Array<{
    reportId: string;
    childId: string;
    reportType: string;
    periodStart: string;
    periodEnd: string;
    ageMonthsStart: number;
    ageMonthsEnd: number;
    content: string;
    generatedAt: string;
    createdAt: string;
  }>>('get_growth_reports', { childId, reportType: reportType ?? null });
}

export function updateGrowthReportContent(params: { reportId: string; content: string; now: string }) {
  return invoke<void>('update_growth_report_content', params);
}
