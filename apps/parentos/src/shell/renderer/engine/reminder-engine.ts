/**
 * reminder-engine.ts — ParentOS 提醒引擎核心
 *
 * 基于孩子月龄 + 养育模式，从 reminder-rules 知识库计算当前活跃提醒。
 * 这是整个产品的心脏。
 *
 * 数据流: reminder-rules.yaml → generated knowledge-base → engine → reminder_states (SQLite)
 */

import type { NurtureMode } from '../app-shell/app-store.js';
import type {
  ReminderRule as GenReminderRule,
  ReminderVisibility,
  ReminderPriority,
} from '../knowledge-base/index.js';

// Re-export generated types for consumers
export type { ReminderVisibility, ReminderPriority };
export type { GenReminderRule as ReminderRule };

export type ReminderStatus = 'pending' | 'active' | 'completed' | 'dismissed' | 'overdue';

export interface ActiveReminder {
  rule: GenReminderRule;
  visibility: ReminderVisibility;
  status: ReminderStatus;
  repeatIndex: number;
  effectiveAgeMonths: number;
}

export interface ReminderState {
  stateId: string;
  childId: string;
  ruleId: string;
  status: ReminderStatus;
  repeatIndex: number;
  completedAt: string | null;
  dismissedAt: string | null;
}

// ── Engine ─────────────────────────────────────────────────

/**
 * Compute which reminders are active for a child at a given age
 * under a given nurture mode.
 */
export function computeActiveReminders(
  rules: readonly GenReminderRule[],
  ageMonths: number,
  nurtureMode: NurtureMode,
  domainOverrides: Record<string, NurtureMode> | null,
  existingStates: ReminderState[],
): ActiveReminder[] {
  const stateMap = new Map<string, ReminderState>();
  for (const state of existingStates) {
    const key = `${state.ruleId}:${state.repeatIndex}`;
    stateMap.set(key, state);
  }

  const active: ActiveReminder[] = [];

  for (const rule of rules) {
    // Skip personalized rules — they require AI trigger, not age-based
    if (rule.category === 'personalized') continue;

    const effectiveMode = domainOverrides?.[rule.domain] ?? nurtureMode;
    const visibility = rule.nurtureMode[effectiveMode];

    // Hidden rules are not shown at all
    if (visibility === 'hidden') continue;

    if (rule.repeatRule) {
      // Repeating rule: generate instances
      const { intervalMonths, maxRepeats } = rule.repeatRule;
      const maxCount = maxRepeats === -1 ? 100 : maxRepeats;

      for (let i = 0; i <= maxCount; i++) {
        const triggerAge = rule.triggerAge.startMonths + i * intervalMonths;
        const endAge = rule.triggerAge.endMonths === -1 ? 216 : rule.triggerAge.endMonths;

        if (triggerAge > endAge) break;

        // Show if within window: trigger age <= current age + 1 month lookahead
        if (triggerAge <= ageMonths + 1 && triggerAge >= ageMonths - intervalMonths) {
          const stateKey = `${rule.ruleId}:${i}`;
          const existingState = stateMap.get(stateKey);

          if (existingState?.status === 'completed' || existingState?.status === 'dismissed') {
            continue;
          }

          const status: ReminderStatus = existingState?.status ?? (triggerAge <= ageMonths ? 'active' : 'pending');

          active.push({
            rule,
            visibility,
            status,
            repeatIndex: i,
            effectiveAgeMonths: triggerAge,
          });
        }
      }
    } else {
      // Non-repeating rule
      const startAge = rule.triggerAge.startMonths;
      const endAge = rule.triggerAge.endMonths === -1 ? 216 : rule.triggerAge.endMonths;

      // Show if child is within the trigger window (with 1 month lookahead)
      if (ageMonths >= startAge - 1 && ageMonths <= endAge + 1) {
        const stateKey = `${rule.ruleId}:0`;
        const existingState = stateMap.get(stateKey);

        if (existingState?.status === 'completed' || existingState?.status === 'dismissed') {
          continue;
        }

        let status: ReminderStatus;
        if (ageMonths < startAge) {
          status = 'pending';
        } else if (ageMonths > endAge) {
          status = 'overdue';
        } else {
          status = existingState?.status ?? 'active';
        }

        active.push({
          rule,
          visibility,
          status,
          repeatIndex: 0,
          effectiveAgeMonths: startAge,
        });
      }
    }
  }

  // Sort: overdue first, then by priority, then by trigger age
  const priorityOrder: Record<string, number> = { P0: 0, P1: 1, P2: 2, P3: 3 };
  const statusOrder: Record<string, number> = { overdue: 0, active: 1, pending: 2, completed: 3, dismissed: 4 };

  active.sort((a, b) => {
    const statusDiff = (statusOrder[a.status] ?? 9) - (statusOrder[b.status] ?? 9);
    if (statusDiff !== 0) return statusDiff;
    const priorityDiff = (priorityOrder[a.rule.priority] ?? 9) - (priorityOrder[b.rule.priority] ?? 9);
    if (priorityDiff !== 0) return priorityDiff;
    return a.effectiveAgeMonths - b.effectiveAgeMonths;
  });

  return active;
}

/**
 * Filter reminders into UI sections for the timeline page.
 */
export function partitionReminders(reminders: ActiveReminder[]) {
  return {
    today: reminders.filter((r) => r.status === 'overdue' || (r.status === 'active' && r.visibility === 'push')),
    upcoming: reminders.filter((r) => r.status === 'pending'),
    silent: reminders.filter((r) => r.status === 'active' && r.visibility === 'silent'),
  };
}
