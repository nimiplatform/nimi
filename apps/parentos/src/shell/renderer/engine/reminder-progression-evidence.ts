/**
 * reminder-progression-evidence.ts — kind-aware progression evidence summary.
 *
 * Authoritative contract: reminder-interaction-contract.md#PO-REMI-009
 *
 * Downstream consumers (reports, narrative prompts, journal guided prompts)
 * cite this shape rather than reading raw reminder_states rows, so narrative
 * phrasing stays honest: acknowledged ≠ completed; practicing carries its
 * real count; consulted requires the AI conversation link.
 */

import type { ReminderRule as GenReminderRule } from '../knowledge-base/index.js';
import type { ReminderState } from './reminder-engine.js';

export interface ReminderProgressionEvidence {
  tasksCompleted: number;
  guidesAcknowledged: number;
  guidesReflected: number;
  practicesInProgress: number;
  practicesHabituated: number;
  practiceTotalEvents: number;
  consultsCompleted: number;
  unfinished: number;
}

export function summarizeReminderProgression(
  states: readonly ReminderState[],
  rules: readonly GenReminderRule[],
): ReminderProgressionEvidence {
  const ruleById = new Map(rules.map((rule) => [rule.ruleId, rule] as const));
  const evidence: ReminderProgressionEvidence = {
    tasksCompleted: 0,
    guidesAcknowledged: 0,
    guidesReflected: 0,
    practicesInProgress: 0,
    practicesHabituated: 0,
    practiceTotalEvents: 0,
    consultsCompleted: 0,
    unfinished: 0,
  };
  for (const state of states) {
    if (state.notApplicable === 1) continue;
    const rule = ruleById.get(state.ruleId);
    if (!rule) continue; // PO-TIME-007 fail-close handled upstream; silently skip here.

    switch (rule.kind) {
      case 'task':
        if (state.completedAt) evidence.tasksCompleted += 1;
        else evidence.unfinished += 1;
        break;
      case 'guide':
        if (state.reflectedAt) evidence.guidesReflected += 1;
        if (state.acknowledgedAt) evidence.guidesAcknowledged += 1;
        else evidence.unfinished += 1;
        break;
      case 'practice':
        if (state.practiceHabituatedAt) evidence.practicesHabituated += 1;
        else if (state.practiceStartedAt) evidence.practicesInProgress += 1;
        else evidence.unfinished += 1;
        evidence.practiceTotalEvents += state.practiceCount;
        break;
      case 'consult':
        if (state.consultedAt && state.consultationConversationId) {
          evidence.consultsCompleted += 1;
        } else {
          evidence.unfinished += 1;
        }
        break;
    }
  }
  return evidence;
}
