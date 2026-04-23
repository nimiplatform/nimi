/**
 * reminder-state-mapper.ts — serialization shim between the SQLite bridge row
 * shape and the engine's `ReminderState` interface.
 *
 * Keeping this as a thin one-off module (rather than inlining it in
 * reminder-engine.ts) reduces the engine file's line count so the AI-context
 * file-size governance stays under 800 for production modules.
 */

import type { ReminderState, ReminderStatus } from './reminder-engine.js';

export interface ReminderStateRowShape {
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
  acknowledgedAt?: string | null;
  reflectedAt?: string | null;
  practiceStartedAt?: string | null;
  practiceLastAt?: string | null;
  practiceCount?: number;
  practiceHabituatedAt?: string | null;
  consultedAt?: string | null;
  consultationConversationId?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export function mapReminderStateRow(row: ReminderStateRowShape): ReminderState {
  return {
    stateId: row.stateId,
    childId: row.childId,
    ruleId: row.ruleId,
    status: row.status as ReminderStatus,
    activatedAt: row.activatedAt,
    completedAt: row.completedAt,
    dismissedAt: row.dismissedAt,
    dismissReason: row.dismissReason,
    repeatIndex: row.repeatIndex,
    nextTriggerAt: row.nextTriggerAt,
    snoozedUntil: row.snoozedUntil,
    scheduledDate: row.scheduledDate,
    notApplicable: row.notApplicable,
    plannedForDate: row.plannedForDate,
    surfaceRank: row.surfaceRank,
    lastSurfacedAt: row.lastSurfacedAt,
    surfaceCount: row.surfaceCount,
    notes: row.notes,
    acknowledgedAt: row.acknowledgedAt ?? null,
    reflectedAt: row.reflectedAt ?? null,
    practiceStartedAt: row.practiceStartedAt ?? null,
    practiceLastAt: row.practiceLastAt ?? null,
    practiceCount: row.practiceCount ?? 0,
    practiceHabituatedAt: row.practiceHabituatedAt ?? null,
    consultedAt: row.consultedAt ?? null,
    consultationConversationId: row.consultationConversationId ?? null,
    createdAt: row.createdAt ?? null,
    updatedAt: row.updatedAt ?? null,
  };
}
