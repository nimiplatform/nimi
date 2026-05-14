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

export type OrthodonticCheckinType = 'aligner-change' | 'expander-activation';

/**
 * Wear-gap interval reason taxonomy (PO-ORTHO-005a).
 */
export type OrthodonticUnwearReason = 'meal' | 'sport' | 'school' | 'sleep' | 'other';

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
  /** Expander only. Per-appliance activation-turn cadence in days; overrides the
   * protocol-rule default. NULL for every non-expander type (PO-ORTHO-014). */
  activationIntervalDays: number | null;
  /** Clear-aligner only. Total tray count in the prescribed series (PO-ORTHO-003). */
  totalAligners: number | null;
  /** Clear-aligner only. Prescribed wear days per tray before switching (PO-ORTHO-003). */
  daysPerAligner: number | null;
  /** Per-appliance treatment phase: a `phaseId` admitted for this `applianceType`
   * in `orthodontic-protocols.yaml#appliancePhases`, or NULL ("not yet set"). PO-ORTHO-013. */
  currentPhase: string | null;
  /** ISO 8601 date `currentPhase` was entered. NULL iff `currentPhase` is NULL. PO-ORTHO-013. */
  phaseStartedAt: string | null;
  reviewIntervalDays: number | null;
  lastReviewAt: string | null;
  nextReviewDate: string | null;
  /** Parent-entered free-text agenda for the appliance's next review visit.
   * Never AI-generated (PO-ORTHO-015). */
  nextReviewAgenda: string | null;
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
  /**
   * PO-ORTHO-008 cycle anchor: ISO 8601 datetime when the event actually
   * occurred. Null on rows persisted before schema v19 — consumers fall back
   * to `checkinDate` at 00:00 UTC for those rows.
   */
  checkinAt: string | null;
  activationIndex: number | null;
  alignerIndex: number | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface OrthodonticUnwearIntervalRow {
  intervalId: string;
  childId: string;
  caseId: string;
  applianceId: string;
  startAt: string;
  /** Null = "still un-worn" (open interval). At most one open per applianceId. */
  endAt: string | null;
  reason: OrthodonticUnwearReason | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface OrthodonticDashboardProjection {
  activeCase: OrthodonticCaseRow | null;
  activeAppliances: OrthodonticApplianceRow[];
  nextReviewDate: string | null;
}

/**
 * Discriminated journey entry returned by `getOrthodonticJourney`. The Rust
 * tag is `kind` (kebab-case). Past entries use `occurredAt` (or `startAt` for
 * unwear-interval); future entries use `predictedAt`.
 */
export type OrthodonticJourneyEntry =
  | { kind: 'case-started'; occurredAt: string; caseType: OrthodonticCaseType; stage: OrthodonticStage }
  | { kind: 'appliance-started'; occurredAt: string; applianceId: string; applianceType: OrthodonticApplianceType }
  | { kind: 'appliance-paused'; occurredAt: string; applianceId: string; reason: string | null }
  | { kind: 'appliance-completed'; occurredAt: string; applianceId: string }
  | { kind: 'aligner-change'; occurredAt: string; applianceId: string; alignerIndex: number }
  | { kind: 'expander-activation'; occurredAt: string; applianceId: string; activationIndex: number }
  | { kind: 'clinical-event'; occurredAt: string; eventType: string; hospital: string | null; notes: string | null; recordId: string }
  | { kind: 'unwear-interval'; startAt: string; endAt: string | null; durationHours: number | null; reason: OrthodonticUnwearReason | null }
  | { kind: 'next-clinical-review'; predictedAt: string; applianceId: string; ruleId: string }
  | { kind: 'next-aligner-change'; predictedAt: string; applianceId: string; alignerIndex: number }
  | { kind: 'cycle-planned-switch'; predictedAt: string; applianceId: string }
  | { kind: 'case-planned-end'; predictedAt: string };

export interface OrthodonticJourney {
  past: OrthodonticJourneyEntry[];
  future: OrthodonticJourneyEntry[];
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
  /** Expander only; per-appliance activation-turn cadence in days. MUST be NULL
   * for non-expander types; positive when set (PO-ORTHO-014). */
  activationIntervalDays: number | null;
  /** Clear-aligner only; required (positive integer) when applianceType='clear-aligner', NULL otherwise. */
  totalAligners: number | null;
  /** Clear-aligner only; required (positive integer) when applianceType='clear-aligner', NULL otherwise. */
  daysPerAligner: number | null;
  /** Initial treatment phase; when set MUST be a `phaseId` admitted for this
   * `applianceType` (PO-ORTHO-013). Pass NULL to leave unset. */
  currentPhase: string | null;
  /** ISO 8601 date; MUST be set iff `currentPhase` is set (PO-ORTHO-013). */
  phaseStartedAt: string | null;
  reviewIntervalDays: number | null;
  /** Parent-entered next-review agenda free-text, or NULL (PO-ORTHO-015). */
  nextReviewAgenda: string | null;
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

/**
 * Edits the in-flight wear plan of an existing appliance. Same fail-close
 * rules as `insertOrthodonticAppliance` (PO-ORTHO-003): clear-aligner requires
 * positive `totalAligners` and `daysPerAligner`; non-clear-aligner must keep
 * both NULL; `activationIntervalDays` is expander-only and positive when set
 * (PO-ORTHO-014). Does NOT mutate `currentPhase` / `phaseStartedAt` — those go
 * through `advanceOrthodonticAppliancePhase`.
 */
export function updateOrthodonticAppliancePlan(params: {
  applianceId: string;
  prescribedHoursPerDay: number | null;
  totalAligners: number | null;
  daysPerAligner: number | null;
  /** Expander only; per-appliance activation-turn cadence in days (PO-ORTHO-014). */
  activationIntervalDays: number | null;
  /** Parent-entered next-review agenda free-text, or NULL (PO-ORTHO-015). */
  nextReviewAgenda: string | null;
  now: string;
}) {
  return invoke<void>('update_orthodontic_appliance_plan', params);
}

/**
 * Parent-initiated, adjacency-only treatment-phase advance (PO-ORTHO-013). The
 * admitted `nextPhase` is the immediate next `phaseId` in the appliance type's
 * sequence — the first phase when `currentPhase` is NULL, otherwise the phase
 * one step after the current one. Any other target fail-closes at the Rust
 * command layer.
 */
export function advanceOrthodonticAppliancePhase(params: {
  applianceId: string;
  nextPhase: string;
  now: string;
}) {
  return invoke<void>('advance_orthodontic_appliance_phase', params);
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
  /**
   * ISO 8601 datetime when the event actually occurred. The Rust command
   * fail-closes if its UTC date component does not match `checkinDate`.
   * Pass `null` only for compatibility paths that intentionally accept the
   * legacy date-midnight anchor (PO-ORTHO-008 fallback).
   */
  checkinAt: string | null;
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

// ── Wear-gap intervals (PO-ORTHO-005a) ────────────────────

export function insertUnwearInterval(params: {
  intervalId: string;
  childId: string;
  caseId: string;
  applianceId: string;
  /** ISO 8601 datetime when the appliance was taken out. */
  startAt: string;
  /** ISO 8601 datetime when the appliance was put back. Null = open ("still un-worn"). */
  endAt: string | null;
  reason: OrthodonticUnwearReason | null;
  notes: string | null;
  now: string;
}) {
  return invoke<void>('insert_unwear_interval', params);
}

/** Closes an open interval. Rust verifies the interval is currently open. */
export function closeUnwearInterval(params: {
  intervalId: string;
  endAt: string;
  now: string;
}) {
  return invoke<void>('close_unwear_interval', params);
}

/** Edits an existing interval. May reopen a closed one (subject to open-uniqueness). */
export function updateUnwearInterval(params: {
  intervalId: string;
  startAt: string;
  endAt: string | null;
  reason: OrthodonticUnwearReason | null;
  notes: string | null;
  now: string;
}) {
  return invoke<void>('update_unwear_interval', params);
}

export function deleteUnwearInterval(intervalId: string) {
  return invoke<void>('delete_unwear_interval', { intervalId });
}

export function getUnwearIntervals(params: {
  applianceId: string;
  limit: number | null;
}) {
  return invoke<OrthodonticUnwearIntervalRow[]>('get_unwear_intervals', params);
}

// ── Journey projection ────────────────────────────────────

export function getOrthodonticJourney(params: { childId: string; caseId: string }) {
  return invoke<OrthodonticJourney>('get_orthodontic_journey', params);
}
