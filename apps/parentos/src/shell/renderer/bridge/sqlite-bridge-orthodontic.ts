/**
 * Typed Tauri bridge for orthodontic case/appliance/checkin surfaces.
 * Authority: orthodontic-contract.md and orthodontic-protocols.yaml.
 *
 * Admitted enums here MUST match the Rust command validators in
 * src-tauri/src/sqlite/queries/orthodontic.rs. Drift = fail-close at the
 * Rust layer, surfaced as a user-visible error.
 */

import { invoke } from '@tauri-apps/api/core';

/**
 * caseType values READABLE from storage. `unknown-legacy` is a
 * migration-only transitional value (PO-ORTHO-002a): the Rust command layer
 * refuses to write it, so it appears only on rows authored by migration v9.
 * The UI must treat it as "待确认" and prompt re-classification.
 */
export type OrthodonticCaseType =
  | 'early-intervention'
  | 'fixed-braces'
  | 'clear-aligners'
  | 'unknown-legacy';

/** caseType values WRITABLE from the UI (PO-ORTHO-002a). */
export type WritableOrthodonticCaseType = Exclude<OrthodonticCaseType, 'unknown-legacy'>;

export type OrthodonticStage =
  | 'assessment'
  | 'planning'
  | 'active'
  | 'retention'
  | 'completed';

export type OrthodonticApplianceType =
  | 'twin-block'
  | 'expander'
  | 'activator'
  | 'metal-braces'
  | 'ceramic-braces'
  | 'clear-aligner'
  | 'retainer-fixed'
  | 'retainer-removable';

export type OrthodonticApplianceStatus = 'active' | 'paused' | 'completed';

export type OrthodonticCheckinType =
  | 'wear-daily'
  | 'aligner-change'
  | 'expander-activation'
  | 'retention-wear';

export type OrthodonticComplianceBucket = 'done' | 'partial' | 'missed';

export interface OrthodonticCaseRow {
  caseId: string;
  childId: string;
  caseType: OrthodonticCaseType;
  stage: OrthodonticStage;
  startedAt: string;
  plannedEndAt: string | null;
  actualEndAt: string | null;
  primaryIssues: string | null;
  providerName: string | null;
  providerInstitution: string | null;
  nextReviewDate: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface OrthodonticApplianceRow {
  applianceId: string;
  caseId: string;
  childId: string;
  applianceType: OrthodonticApplianceType;
  status: OrthodonticApplianceStatus;
  startedAt: string;
  endedAt: string | null;
  prescribedHoursPerDay: number | null;
  prescribedActivations: number | null;
  completedActivations: number;
  reviewIntervalDays: number | null;
  lastReviewAt: string | null;
  nextReviewDate: string | null;
  pauseReason: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface OrthodonticCheckinRow {
  checkinId: string;
  childId: string;
  caseId: string;
  applianceId: string;
  checkinType: OrthodonticCheckinType;
  checkinDate: string;
  actualWearHours: number | null;
  prescribedHours: number | null;
  complianceBucket: OrthodonticComplianceBucket | null;
  activationIndex: number | null;
  alignerIndex: number | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface OrthodonticDashboardProjection {
  activeCase: OrthodonticCaseRow | null;
  activeAppliances: OrthodonticApplianceRow[];
  nextReviewDate: string | null;
  compliance30d: {
    done: number;
    partial: number;
    missed: number;
    total: number;
    /** Must be displayed verbatim or paraphrased as 任务达成率近似 per PO-ORTHO-008. */
    note: string;
  };
}

// ── Cases ─────────────────────────────────────────────────

export function insertOrthodonticCase(params: {
  caseId: string;
  childId: string;
  /** unknown-legacy is rejected by the Rust command layer (PO-ORTHO-002a). */
  caseType: WritableOrthodonticCaseType;
  stage: OrthodonticStage;
  startedAt: string;
  plannedEndAt: string | null;
  primaryIssues: string | null;
  providerName: string | null;
  providerInstitution: string | null;
  notes: string | null;
  now: string;
}) {
  return invoke<void>('insert_orthodontic_case', params);
}

export function updateOrthodonticCase(params: {
  caseId: string;
  /** unknown-legacy is rejected by the Rust command layer (PO-ORTHO-002a); use this call to re-classify. */
  caseType: WritableOrthodonticCaseType;
  stage: OrthodonticStage;
  startedAt: string;
  plannedEndAt: string | null;
  actualEndAt: string | null;
  primaryIssues: string | null;
  providerName: string | null;
  providerInstitution: string | null;
  notes: string | null;
  now: string;
}) {
  return invoke<void>('update_orthodontic_case', params);
}

export function deleteOrthodonticCase(caseId: string) {
  return invoke<void>('delete_orthodontic_case', { caseId });
}

export function getOrthodonticCases(childId: string) {
  return invoke<OrthodonticCaseRow[]>('get_orthodontic_cases', { childId });
}

// ── Appliances ────────────────────────────────────────────

export function insertOrthodonticAppliance(params: {
  applianceId: string;
  caseId: string;
  childId: string;
  /** Child birthDate; Rust uses it to enforce the PO-ORTHO-009 age gate. */
  childBirthDate: string;
  applianceType: OrthodonticApplianceType;
  status: OrthodonticApplianceStatus;
  startedAt: string;
  prescribedHoursPerDay: number | null;
  prescribedActivations: number | null;
  reviewIntervalDays: number | null;
  notes: string | null;
  now: string;
}) {
  return invoke<void>('insert_orthodontic_appliance', params);
}

export function updateOrthodonticApplianceStatus(params: {
  applianceId: string;
  status: OrthodonticApplianceStatus;
  /** Required when status = 'paused' per PO-ORTHO-004. */
  pauseReason: string | null;
  /** Required when status = 'completed'. */
  endedAt: string | null;
  now: string;
}) {
  return invoke<void>('update_orthodontic_appliance_status', params);
}

export function updateOrthodonticApplianceReview(params: {
  applianceId: string;
  lastReviewAt: string | null;
  nextReviewDate: string | null;
  now: string;
}) {
  return invoke<void>('update_orthodontic_appliance_review', params);
}

export function deleteOrthodonticAppliance(applianceId: string) {
  return invoke<void>('delete_orthodontic_appliance', { applianceId });
}

export function getOrthodonticAppliances(caseId: string) {
  return invoke<OrthodonticApplianceRow[]>('get_orthodontic_appliances', { caseId });
}

// ── Checkins ──────────────────────────────────────────────

export function insertOrthodonticCheckin(params: {
  checkinId: string;
  childId: string;
  caseId: string;
  applianceId: string;
  checkinType: OrthodonticCheckinType;
  checkinDate: string;
  actualWearHours: number | null;
  prescribedHours: number | null;
  activationIndex: number | null;
  alignerIndex: number | null;
  notes: string | null;
  now: string;
}) {
  return invoke<void>('insert_orthodontic_checkin', params);
}

export function deleteOrthodonticCheckin(checkinId: string) {
  return invoke<void>('delete_orthodontic_checkin', { checkinId });
}

export function getOrthodonticCheckins(params: {
  applianceId: string;
  limitDays: number | null;
}) {
  return invoke<OrthodonticCheckinRow[]>('get_orthodontic_checkins', params);
}

// ── Ortho clinical event writer ───────────────────────────

/** Admitted ortho-lifecycle eventTypes for the clinical-event writer. */
export type OrthoClinicalEventType =
  | 'ortho-review'
  | 'ortho-adjustment'
  | 'ortho-issue'
  | 'ortho-end';

/**
 * Writes an ortho lifecycle event into `dental_records` via the dedicated
 * Rust writer. These events must NOT go through the generic dental form —
 * see PO-PROF-008 and PO-ORTHO-001.
 */
export function insertOrthoClinicalDentalRecord(params: {
  recordId: string;
  childId: string;
  eventType: OrthoClinicalEventType;
  eventDate: string;
  ageMonths: number;
  hospital: string | null;
  notes: string | null;
  now: string;
}) {
  return invoke<void>('insert_ortho_clinical_dental_record', params);
}

// ── Dashboard ─────────────────────────────────────────────

export function getOrthodonticDashboard(childId: string) {
  return invoke<OrthodonticDashboardProjection>('get_orthodontic_dashboard', { childId });
}
