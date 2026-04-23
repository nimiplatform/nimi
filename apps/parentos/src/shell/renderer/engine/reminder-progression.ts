/**
 * reminder-progression.ts — per-kind progression state machines.
 *
 * Authoritative contract: reminder-interaction-contract.md#PO-REMI-003
 *                         reminder-interaction-contract.md#PO-REMI-005
 *
 * This module is the single source of truth for what transitions are admissible
 * per kind and what partial `reminder_states` row shape each transition produces.
 * `applyReminderAction` in reminder-actions.ts delegates to `applyTransition` here
 * to derive the row diff; it then layers on agenda-stability metadata and calls
 * the sqlite bridge. No other module may synthesize progression column values.
 */

import type { ReminderKind } from '../knowledge-base/index.js';

/**
 * PO-REMI-003 per-kind progression states. Derived from the reminder_states
 * timestamp columns; never persisted as a standalone enum. The engine's
 * `toLifecycle` mapper projects these into the richer `ReminderLifecycle`.
 */
export type ProgressionState =
  | 'pending'
  | 'due'
  | 'acknowledged'
  | 'reflected'
  | 'practicing'
  | 'habituated'
  | 'consulted'
  | 'completed'
  | 'snoozed'
  | 'scheduled'
  | 'not_applicable';

/**
 * PO-REMI-005 action enumeration. Discriminated union: each kind admits a
 * distinct set of terminal-ish transitions, plus the kind-agnostic lifecycle
 * actions (snooze / mark_not_applicable / dismiss_today / restore / schedule).
 *
 * `open_advisor` is a routing intent only — it does not write any progression
 * timestamp. The advisor module writes `consultedAt` + `consultationConversationId`
 * through the dedicated `upsertReminderConsultation` bridge on AI first reply.
 */
export type ReminderActionCommand =
  // Kind-agnostic
  | { type: 'snooze'; snoozedUntil?: string | null }
  | { type: 'mark_not_applicable' }
  | { type: 'dismiss_today' }
  | { type: 'restore' }
  | { type: 'schedule'; scheduledDate: string | null }
  // task
  | { type: 'complete' }
  // guide
  | { type: 'acknowledge' }
  | { type: 'reflect' }
  // practice
  | { type: 'start_practicing' }
  | { type: 'log_practice' }
  | { type: 'mark_habituated' }
  // consult (UI-level routing intent only; writeback comes from advisor module)
  | { type: 'open_advisor' };

export type ReminderActionType = ReminderActionCommand['type'];

const KIND_ACTION_WHITELIST: Record<ReminderKind, ReadonlySet<ReminderActionType>> = {
  task: new Set(['complete', 'snooze', 'mark_not_applicable', 'dismiss_today', 'restore', 'schedule']),
  guide: new Set(['acknowledge', 'reflect', 'snooze', 'mark_not_applicable', 'dismiss_today', 'restore', 'schedule']),
  practice: new Set(['start_practicing', 'log_practice', 'mark_habituated', 'snooze', 'mark_not_applicable', 'dismiss_today', 'restore', 'schedule']),
  consult: new Set(['open_advisor', 'snooze', 'mark_not_applicable', 'dismiss_today', 'restore', 'schedule']),
};

export function isActionAdmissibleForKind(kind: ReminderKind, action: ReminderActionType): boolean {
  return KIND_ACTION_WHITELIST[kind]?.has(action) ?? false;
}

/**
 * Previous-state context required for progression math. Keeping this an
 * explicit shape instead of the full ReminderState lets the caller stay
 * decoupled from storage-layer serialization concerns.
 */
export interface ProgressionContext {
  kind: ReminderKind;
  /** Existing progression column values read from reminder_states. */
  acknowledgedAt: string | null;
  reflectedAt: string | null;
  practiceStartedAt: string | null;
  practiceLastAt: string | null;
  practiceCount: number;
  practiceHabituatedAt: string | null;
  consultedAt: string | null;
  consultationConversationId: string | null;
  completedAt: string | null;
  notApplicable: number;
}

/**
 * Partial diff returned by `applyTransition`. Only columns the caller should
 * forward to the upsert bridge. Agenda-stability metadata (surfaceRank etc.) is
 * the caller's concern, not this module's.
 */
export interface ProgressionDiff {
  status: 'pending' | 'active' | 'completed';
  completedAt: string | null;
  acknowledgedAt: string | null;
  reflectedAt: string | null;
  practiceStartedAt: string | null;
  practiceLastAt: string | null;
  practiceCount: number;
  practiceHabituatedAt: string | null;
  consultedAt: string | null;
  consultationConversationId: string | null;
  notApplicable: number;
}

export class ProgressionViolationError extends Error {
  readonly kind: ReminderKind;
  readonly action: ReminderActionType;
  readonly reason: string;
  constructor(kind: ReminderKind, action: ReminderActionType, reason: string) {
    super(`progression violation: kind=${kind} action=${action} (${reason})`);
    this.name = 'ProgressionViolationError';
    this.kind = kind;
    this.action = action;
    this.reason = reason;
  }
}

function baseDiff(context: ProgressionContext): ProgressionDiff {
  return {
    status: 'active',
    completedAt: context.completedAt,
    acknowledgedAt: context.acknowledgedAt,
    reflectedAt: context.reflectedAt,
    practiceStartedAt: context.practiceStartedAt,
    practiceLastAt: context.practiceLastAt,
    practiceCount: context.practiceCount,
    practiceHabituatedAt: context.practiceHabituatedAt,
    consultedAt: context.consultedAt,
    consultationConversationId: context.consultationConversationId,
    notApplicable: context.notApplicable,
  };
}

/**
 * Apply a single action to a progression context and return the column diff.
 * Throws `ProgressionViolationError` on contract violations (PO-REMI-003,
 * PO-REMI-004). Admissibility against PO-REMI-005 is enforced via
 * `isActionAdmissibleForKind`; cross-invariant guards (reflect needs
 * acknowledge, habituate needs started, etc.) live here.
 */
export function applyTransition(
  context: ProgressionContext,
  action: ReminderActionCommand,
  now: string,
): ProgressionDiff {
  if (!isActionAdmissibleForKind(context.kind, action.type)) {
    throw new ProgressionViolationError(
      context.kind,
      action.type,
      `action not admissible for kind per PO-REMI-005`,
    );
  }

  const diff = baseDiff(context);

  switch (action.type) {
    case 'complete':
      // task-only. W4b ensures admissibility already rejects non-task invocations.
      diff.status = 'completed';
      diff.completedAt = now;
      return diff;

    case 'acknowledge':
      diff.status = 'completed';
      diff.acknowledgedAt = now;
      return diff;

    case 'reflect':
      if (!context.acknowledgedAt) {
        throw new ProgressionViolationError(
          context.kind,
          action.type,
          'reflectedAt requires acknowledgedAt non-null (PO-REMI-004)',
        );
      }
      // Reflect does not change status: a guide stays completed once acknowledged.
      diff.status = 'completed';
      diff.reflectedAt = now;
      return diff;

    case 'start_practicing':
      // First entry. If already practicing, act as a re-entry (log_practice).
      if (context.practiceHabituatedAt) {
        throw new ProgressionViolationError(
          context.kind,
          action.type,
          'cannot start practicing a habituated rule; use restore first',
        );
      }
      if (!context.practiceStartedAt) {
        diff.practiceStartedAt = now;
      }
      diff.practiceLastAt = now;
      diff.practiceCount = context.practiceCount + 1;
      diff.status = 'active';
      return diff;

    case 'log_practice':
      if (!context.practiceStartedAt) {
        throw new ProgressionViolationError(
          context.kind,
          action.type,
          'log_practice requires practiceStartedAt non-null (start_practicing first)',
        );
      }
      if (context.practiceHabituatedAt) {
        throw new ProgressionViolationError(
          context.kind,
          action.type,
          'cannot log practice on a habituated rule',
        );
      }
      diff.practiceLastAt = now;
      diff.practiceCount = context.practiceCount + 1;
      diff.status = 'active';
      return diff;

    case 'mark_habituated':
      if (!context.practiceStartedAt) {
        throw new ProgressionViolationError(
          context.kind,
          action.type,
          'mark_habituated requires practiceStartedAt non-null (PO-REMI-004)',
        );
      }
      diff.practiceHabituatedAt = now;
      diff.status = 'completed';
      return diff;

    case 'open_advisor':
      // Routing intent. No progression writeback. The advisor module writes
      // consultedAt + consultationConversationId on AI first reply via
      // upsert_reminder_consultation (PO-REMI-007). Preserve existing state.
      return diff;

    case 'snooze':
      // Clear any scheduled slot but preserve progression signals; the parent
      // explicitly asked to postpone — not retract — engagement.
      diff.status = 'active';
      diff.notApplicable = 0;
      return diff;

    case 'mark_not_applicable':
      diff.notApplicable = 1;
      diff.status = 'active';
      return diff;

    case 'dismiss_today':
      // Dismissal is stored on dismissedAt by the caller; progression stays untouched.
      return diff;

    case 'restore':
      // Hard reset — used by admin/debug or by the consult-conversation-cascade
      // path before the cascade helper clears consult columns separately.
      return {
        status: 'pending',
        completedAt: null,
        acknowledgedAt: null,
        reflectedAt: null,
        practiceStartedAt: null,
        practiceLastAt: null,
        practiceCount: 0,
        practiceHabituatedAt: null,
        consultedAt: null,
        consultationConversationId: null,
        notApplicable: 0,
      };

    case 'schedule':
      // Scheduling is tracked via scheduledDate on the caller's row shape.
      // Progression signals are preserved.
      diff.status = 'active';
      diff.notApplicable = 0;
      return diff;
  }
}

/**
 * Convenience: derive the progression state from the current context without
 * applying an action. Used by UI surfaces that need to render the progression
 * stepper without dispatching a transition. Mirrors the kind-aware branches in
 * `toLifecycle` but returns the finer-grained `ProgressionState` rather than
 * the coarser `ReminderLifecycle`.
 */
export function currentProgressionState(context: ProgressionContext): ProgressionState {
  if (context.notApplicable === 1) return 'not_applicable';

  switch (context.kind) {
    case 'task':
      return context.completedAt ? 'completed' : 'due';
    case 'guide':
      if (context.reflectedAt) return 'reflected';
      if (context.acknowledgedAt) return 'acknowledged';
      return 'due';
    case 'practice':
      if (context.practiceHabituatedAt) return 'habituated';
      if (context.practiceStartedAt) return 'practicing';
      return 'due';
    case 'consult':
      if (context.consultedAt && context.consultationConversationId) return 'consulted';
      return 'due';
  }
}
