/**
 * sqlite-bridge.ts — Typed Tauri IPC bridge for ParentOS SQLite operations.
 * Every function maps 1:1 to a #[tauri::command] in queries.rs.
 */

import { invoke } from '@tauri-apps/api/core';

// ── Family ──────────────────────────────────────────────────

export function createFamily(familyId: string, displayName: string, now: string) {
  return invoke<void>('create_family', { familyId, displayName, now });
}

export function getFamily() {
  return invoke<{
    familyId: string;
    displayName: string;
    createdAt: string;
    updatedAt: string;
  } | null>('get_family');
}

// ── Children ────────────────────────────────────────────────

export interface ChildRow {
  childId: string;
  familyId: string;
  displayName: string;
  gender: string;
  birthDate: string;
  birthWeightKg: number | null;
  birthHeightCm: number | null;
  birthHeadCircCm: number | null;
  avatarPath: string | null;
  nurtureMode: string;
  nurtureModeOverrides: string | null;
  allergies: string | null;
  medicalNotes: string | null;
  recorderProfiles: string | null;
  createdAt: string;
  updatedAt: string;
}

export function createChild(params: {
  childId: string;
  familyId: string;
  displayName: string;
  gender: string;
  birthDate: string;
  birthWeightKg: number | null;
  birthHeightCm: number | null;
  birthHeadCircCm: number | null;
  avatarPath: string | null;
  nurtureMode: string;
  nurtureModeOverrides: string | null;
  allergies: string | null;
  medicalNotes: string | null;
  recorderProfiles: string | null;
  now: string;
}) {
  return invoke<void>('create_child', params);
}

export function getChildren(familyId: string) {
  return invoke<ChildRow[]>('get_children', { familyId });
}

export function updateChild(params: {
  childId: string;
  displayName: string;
  gender: string;
  birthDate: string;
  birthWeightKg: number | null;
  birthHeightCm: number | null;
  birthHeadCircCm: number | null;
  avatarPath: string | null;
  nurtureMode: string;
  nurtureModeOverrides: string | null;
  allergies: string | null;
  medicalNotes: string | null;
  recorderProfiles: string | null;
  now: string;
}) {
  return invoke<void>('update_child', params);
}

export function deleteChild(childId: string) {
  return invoke<void>('delete_child', { childId });
}

// ── Growth Measurements ─────────────────────────────────────

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

// ── Milestone Records ───────────────────────────────────────

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

// ── Reminder States ─────────────────────────────────────────

export interface ReminderStateRow {
  stateId: string;
  childId: string;
  ruleId: string;
  status: string;
  activatedAt: string | null;
  completedAt: string | null;
  dismissedAt: string | null;
  dismissReason: string | null;
  repeatIndex: number;
  nextTriggerAt: string | null;
  snoozedUntil: string | null;
  scheduledDate: string | null;
  notApplicable: number;
  plannedForDate: string | null;
  surfaceRank: number | null;
  lastSurfacedAt: string | null;
  surfaceCount: number;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export function upsertReminderState(params: {
  stateId: string;
  childId: string;
  ruleId: string;
  status: string;
  activatedAt: string | null;
  completedAt: string | null;
  dismissedAt: string | null;
  dismissReason: string | null;
  repeatIndex: number;
  nextTriggerAt: string | null;
  snoozedUntil?: string | null;
  scheduledDate?: string | null;
  notApplicable?: number;
  plannedForDate?: string | null;
  surfaceRank?: number | null;
  lastSurfacedAt?: string | null;
  surfaceCount?: number;
  notes: string | null;
  now: string;
}) {
  return invoke<void>('upsert_reminder_state', {
    ...params,
    snoozedUntil: params.snoozedUntil ?? null,
    scheduledDate: params.scheduledDate ?? null,
    notApplicable: params.notApplicable ?? 0,
    plannedForDate: params.plannedForDate ?? null,
    surfaceRank: params.surfaceRank ?? null,
    lastSurfacedAt: params.lastSurfacedAt ?? null,
    surfaceCount: params.surfaceCount ?? 0,
  });
}

export function getReminderStates(childId: string) {
  return invoke<ReminderStateRow[]>('get_reminder_states', { childId });
}

export function getActiveReminders(childId: string) {
  return invoke<ReminderStateRow[]>('get_active_reminders', { childId });
}

// ── Vaccine Records ─────────────────────────────────────────

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

// ── Journal Entries ─────────────────────────────────────────

export interface JournalEntryRow {
  entryId: string;
  childId: string;
  contentType: string;
  textContent: string | null;
  voicePath: string | null;
  photoPaths: string | null;
  recordedAt: string;
  ageMonths: number;
  observationMode: string | null;
  dimensionId: string | null;
  selectedTags: string | null;
  guidedAnswers: string | null;
  observationDuration: number | null;
  keepsake: number;
  moodTag: string | null;
  recorderId: string | null;
  createdAt: string;
  updatedAt: string;
}

export function insertJournalEntry(params: {
  entryId: string;
  childId: string;
  contentType: string;
  textContent: string | null;
  voicePath: string | null;
  photoPaths: string | null;
  recordedAt: string;
  ageMonths: number;
  observationMode: string | null;
  dimensionId: string | null;
  selectedTags: string | null;
  guidedAnswers: string | null;
  observationDuration: number | null;
  keepsake: number;
  moodTag: string | null;
  recorderId: string | null;
  now: string;
}) {
  return invoke<void>('insert_journal_entry', params);
}

export interface JournalTagInsertRow {
  tagId: string;
  domain: string;
  tag: string;
  source: string;
  confidence: number | null;
}

export function insertJournalEntryWithTags(params: {
  entryId: string;
  childId: string;
  contentType: string;
  textContent: string | null;
  voicePath: string | null;
  photoPaths: string | null;
  recordedAt: string;
  ageMonths: number;
  observationMode: string | null;
  dimensionId: string | null;
  selectedTags: string | null;
  guidedAnswers: string | null;
  observationDuration: number | null;
  keepsake: number;
  moodTag: string | null;
  recorderId: string | null;
  aiTags: JournalTagInsertRow[];
  now: string;
}) {
  return invoke<void>('insert_journal_entry_with_tags', params);
}

export function updateJournalEntryWithTags(params: {
  entryId: string;
  childId: string;
  contentType: string;
  textContent: string | null;
  voicePath: string | null;
  photoPaths: string | null;
  recordedAt: string;
  ageMonths: number;
  observationMode: string | null;
  dimensionId: string | null;
  selectedTags: string | null;
  guidedAnswers: string | null;
  observationDuration: number | null;
  keepsake: number;
  moodTag: string | null;
  recorderId: string | null;
  aiTags: JournalTagInsertRow[];
  now: string;
}) {
  return invoke<void>('update_journal_entry_with_tags', params);
}

export function getJournalEntries(childId: string, limit?: number) {
  return invoke<JournalEntryRow[]>('get_journal_entries', { childId, limit: limit ?? null });
}

export function insertJournalTag(params: {
  tagId: string;
  entryId: string;
  domain: string;
  tag: string;
  source: string;
  confidence: number | null;
  now: string;
}) {
  return invoke<void>('insert_journal_tag', params);
}

export function getJournalTags(entryId: string) {
  return invoke<Array<{
    tagId: string;
    entryId: string;
    domain: string;
    tag: string;
    source: string;
    confidence: number | null;
    createdAt: string;
  }>>('get_journal_tags', { entryId });
}

export function updateJournalKeepsake(entryId: string, keepsake: 0 | 1, now: string) {
  return invoke<void>('update_journal_keepsake', { entryId, keepsake, now });
}

export function deleteJournalEntry(entryId: string) {
  return invoke<void>('delete_journal_entry', { entryId });
}

// ── AI Conversations ────────────────────────────────────────

export interface ConversationRow {
  conversationId: string;
  childId: string;
  title: string | null;
  startedAt: string;
  lastMessageAt: string;
  messageCount: number;
  createdAt: string;
}

export function createConversation(params: {
  conversationId: string;
  childId: string;
  title: string | null;
  now: string;
}) {
  return invoke<void>('create_conversation', params);
}

export function getConversations(childId: string) {
  return invoke<ConversationRow[]>('get_conversations', { childId });
}

export interface AiMessageRow {
  messageId: string;
  conversationId: string;
  role: string;
  content: string;
  contextSnapshot: string | null;
  createdAt: string;
}

export function insertAiMessage(params: {
  messageId: string;
  conversationId: string;
  role: string;
  content: string;
  contextSnapshot: string | null;
  now: string;
}) {
  return invoke<void>('insert_ai_message', params);
}

export function getAiMessages(conversationId: string) {
  return invoke<AiMessageRow[]>('get_ai_messages', { conversationId });
}

// ── Growth Reports ──────────────────────────────────────────

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

// ── App Settings ────────────────────────────────────────────

export function setAppSetting(key: string, value: string, now: string) {
  return invoke<void>('set_app_setting', { key, value, now });
}

export function getAppSetting(key: string) {
  return invoke<string | null>('get_app_setting', { key });
}

// ── Dental Records ─────────────────────────────────────────

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

export function getDentalRecords(childId: string) {
  return invoke<DentalRecordRow[]>('get_dental_records', { childId });
}

// ── Allergy Records ────────────────────────────────────────

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

// ── Sleep Records ──────────────────────────────────────────

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

export function getSleepRecords(childId: string, limit?: number) {
  return invoke<SleepRecordRow[]>('get_sleep_records', { childId, limit: limit ?? null });
}

// ── Medical Events ─────────────────────────────────────────

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

// ── Tanner Assessments ─────────────────────────────────────

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

// ── Fitness Assessments ────────────────────────────────────

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

// ── DB Init ─────────────────────────────────────────────────

export function dbInit() {
  return invoke<void>('db_init');
}
