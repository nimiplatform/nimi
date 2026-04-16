import { invoke } from '@tauri-apps/api/core';

export interface DentalRecordRow {
  recordId: string;
  childId: string;
  eventType: string;
  toothId: string | null;
  toothSet: string | null;
  eventDate: string;
  ageMonths: number;
  severity: string | null;
  hospital: string | null;
  notes: string | null;
  photoPath: string | null;
  createdAt: string;
}

export function insertDentalRecord(params: {
  recordId: string;
  childId: string;
  eventType: string;
  toothId: string | null;
  toothSet: string | null;
  eventDate: string;
  ageMonths: number;
  severity: string | null;
  hospital: string | null;
  notes: string | null;
  photoPath: string | null;
  now: string;
}) {
  return invoke<void>('insert_dental_record', params);
}

export function updateDentalRecord(params: {
  recordId: string;
  eventType: string;
  toothId: string | null;
  toothSet: string | null;
  eventDate: string;
  ageMonths: number;
  severity: string | null;
  hospital: string | null;
  notes: string | null;
  photoPath: string | null;
}) {
  return invoke<void>('update_dental_record', params);
}

export function deleteDentalRecord(recordId: string) {
  return invoke<void>('delete_dental_record', { recordId });
}

export function getDentalRecords(childId: string) {
  return invoke<DentalRecordRow[]>('get_dental_records', { childId });
}

export interface AttachmentRow {
  attachmentId: string;
  childId: string;
  ownerTable: string;
  ownerId: string;
  filePath: string;
  fileName: string;
  mimeType: string;
  caption: string | null;
  createdAt: string;
}

export function saveAttachment(params: {
  attachmentId: string;
  childId: string;
  ownerTable: string;
  ownerId: string;
  fileName: string;
  mimeType: string;
  imageBase64: string;
  caption: string | null;
  now: string;
}) {
  return invoke<AttachmentRow>('save_attachment', params);
}

export function getAttachments(childId: string) {
  return invoke<AttachmentRow[]>('get_attachments', { childId });
}

export function getAttachmentsByOwner(childId: string, ownerTable: string, ownerId: string) {
  return invoke<AttachmentRow[]>('get_attachments_by_owner', { childId, ownerTable, ownerId });
}

export function deleteAttachment(attachmentId: string) {
  return invoke<void>('delete_attachment', { attachmentId });
}

export interface AllergyRecordRow {
  recordId: string;
  childId: string;
  allergen: string;
  category: string;
  reactionType: string | null;
  severity: string;
  diagnosedAt: string | null;
  ageMonthsAtDiagnosis: number | null;
  status: string;
  statusChangedAt: string | null;
  confirmedBy: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export function insertAllergyRecord(params: {
  recordId: string;
  childId: string;
  allergen: string;
  category: string;
  reactionType: string | null;
  severity: string;
  diagnosedAt: string | null;
  ageMonthsAtDiagnosis: number | null;
  status: string;
  statusChangedAt: string | null;
  confirmedBy: string | null;
  notes: string | null;
  now: string;
}) {
  return invoke<void>('insert_allergy_record', params);
}

export function updateAllergyRecord(params: {
  recordId: string;
  allergen: string;
  category: string;
  reactionType: string | null;
  severity: string;
  status: string;
  statusChangedAt: string | null;
  confirmedBy: string | null;
  notes: string | null;
  now: string;
}) {
  return invoke<void>('update_allergy_record', params);
}

export function getAllergyRecords(childId: string) {
  return invoke<AllergyRecordRow[]>('get_allergy_records', { childId });
}

export interface SleepRecordRow {
  recordId: string;
  childId: string;
  sleepDate: string;
  bedtime: string | null;
  wakeTime: string | null;
  durationMinutes: number | null;
  napCount: number | null;
  napMinutes: number | null;
  quality: string | null;
  ageMonths: number;
  notes: string | null;
  createdAt: string;
}

export function upsertSleepRecord(params: {
  recordId: string;
  childId: string;
  sleepDate: string;
  bedtime: string | null;
  wakeTime: string | null;
  durationMinutes: number | null;
  napCount: number | null;
  napMinutes: number | null;
  quality: string | null;
  ageMonths: number;
  notes: string | null;
  now: string;
}) {
  return invoke<void>('upsert_sleep_record', params);
}

export function deleteSleepRecord(recordId: string) {
  return invoke<void>('delete_sleep_record', { recordId });
}

export function getSleepRecords(childId: string, limit?: number) {
  return invoke<SleepRecordRow[]>('get_sleep_records', { childId, limit: limit ?? null });
}

export interface MedicalEventRow {
  eventId: string;
  childId: string;
  eventType: string;
  title: string;
  eventDate: string;
  endDate: string | null;
  ageMonths: number;
  severity: string | null;
  result: string | null;
  hospital: string | null;
  medication: string | null;
  dosage: string | null;
  notes: string | null;
  photoPath: string | null;
  createdAt: string;
  updatedAt: string;
}

export function insertMedicalEvent(params: {
  eventId: string;
  childId: string;
  eventType: string;
  title: string;
  eventDate: string;
  endDate: string | null;
  ageMonths: number;
  severity: string | null;
  result: string | null;
  hospital: string | null;
  medication: string | null;
  dosage: string | null;
  notes: string | null;
  photoPath: string | null;
  now: string;
}) {
  return invoke<void>('insert_medical_event', params);
}

export function updateMedicalEvent(params: {
  eventId: string;
  title: string;
  eventDate: string;
  endDate: string | null;
  severity: string | null;
  result: string | null;
  hospital: string | null;
  medication: string | null;
  dosage: string | null;
  notes: string | null;
  photoPath: string | null;
  now: string;
}) {
  return invoke<void>('update_medical_event', params);
}

export function getMedicalEvents(childId: string) {
  return invoke<MedicalEventRow[]>('get_medical_events', { childId });
}

export interface TannerAssessmentRow {
  assessmentId: string;
  childId: string;
  assessedAt: string;
  ageMonths: number;
  breastOrGenitalStage: number | null;
  pubicHairStage: number | null;
  assessedBy: string | null;
  notes: string | null;
  createdAt: string;
}

export function insertTannerAssessment(params: {
  assessmentId: string;
  childId: string;
  assessedAt: string;
  ageMonths: number;
  breastOrGenitalStage: number | null;
  pubicHairStage: number | null;
  assessedBy: string | null;
  notes: string | null;
  now: string;
}) {
  return invoke<void>('insert_tanner_assessment', params);
}

export function getTannerAssessments(childId: string) {
  return invoke<TannerAssessmentRow[]>('get_tanner_assessments', { childId });
}

export interface FitnessAssessmentRow {
  assessmentId: string;
  childId: string;
  assessedAt: string;
  ageMonths: number;
  assessmentSource: string | null;
  run50m: number | null;
  run800m: number | null;
  run1000m: number | null;
  run50x8: number | null;
  sitAndReach: number | null;
  standingLongJump: number | null;
  sitUps: number | null;
  pullUps: number | null;
  ropeSkipping: number | null;
  vitalCapacity: number | null;
  run10mShuttle: number | null;
  tennisBallThrow: number | null;
  doubleFootJump: number | null;
  balanceBeam: number | null;
  footArchStatus: string | null;
  overallGrade: string | null;
  notes: string | null;
  createdAt: string;
}

export function insertFitnessAssessment(params: {
  assessmentId: string;
  childId: string;
  assessedAt: string;
  ageMonths: number;
  assessmentSource: string | null;
  run50m: number | null;
  run800m: number | null;
  run1000m: number | null;
  run50x8: number | null;
  sitAndReach: number | null;
  standingLongJump: number | null;
  sitUps: number | null;
  pullUps: number | null;
  ropeSkipping: number | null;
  vitalCapacity: number | null;
  run10mShuttle: number | null;
  tennisBallThrow: number | null;
  doubleFootJump: number | null;
  balanceBeam: number | null;
  footArchStatus: string | null;
  overallGrade: string | null;
  notes: string | null;
  now: string;
}) {
  return invoke<void>('insert_fitness_assessment', params);
}

export function getFitnessAssessments(childId: string) {
  return invoke<FitnessAssessmentRow[]>('get_fitness_assessments', { childId });
}

export interface SectionSummary {
  sectionId: string;
  recordCount: number;
  lastUpdatedAt: string | null;
  state: 'ok' | 'empty' | 'error';
  errorMessage: string | null;
}

export function getProfileSectionSummaries(childId: string) {
  return invoke<SectionSummary[]>('get_profile_section_summaries', { childId });
}

export interface OutdoorRecordRow {
  recordId: string;
  childId: string;
  activityDate: string;
  durationMinutes: number;
  note: string | null;
  createdAt: string;
  updatedAt: string;
}

export function insertOutdoorRecord(params: {
  recordId: string;
  childId: string;
  activityDate: string;
  durationMinutes: number;
  note: string | null;
  now: string;
}) {
  return invoke<void>('insert_outdoor_record', params);
}

export function updateOutdoorRecord(params: {
  recordId: string;
  activityDate: string | null;
  durationMinutes: number | null;
  note: string | null;
  now: string;
}) {
  return invoke<void>('update_outdoor_record', params);
}

export function deleteOutdoorRecord(recordId: string) {
  return invoke<void>('delete_outdoor_record', { recordId });
}

export function getOutdoorRecords(childId: string, startDate?: string, endDate?: string) {
  return invoke<OutdoorRecordRow[]>('get_outdoor_records', {
    childId,
    startDate: startDate ?? null,
    endDate: endDate ?? null,
  });
}

export function getOutdoorGoal(childId: string) {
  return invoke<number | null>('get_outdoor_goal', { childId });
}

export function setOutdoorGoal(childId: string, goalMinutes: number, now: string) {
  return invoke<void>('set_outdoor_goal', { childId, goalMinutes, now });
}
