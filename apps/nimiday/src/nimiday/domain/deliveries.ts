import { inQuietHours, isReminderPending, reminderInstant, type ReminderSettings } from './reminders.js';
import type { LifeItem } from './types.js';

export type ReminderDelivery = {
  readonly item: LifeItem;
  readonly at: string;
  /** Whether this delivery may interrupt with a system notification. */
  readonly interrupt: boolean;
  /** Held back because of quiet hours; summarized when they end. */
  readonly quiet: boolean;
};

export type ReminderPlan = {
  readonly deliver: readonly ReminderDelivery[];
  /** Came due while NimiDay was not running; recorded, never replayed as fresh alerts. */
  readonly missed: readonly { readonly item: LifeItem; readonly at: string }[];
};

/** Late by more than this when first seen means NimiDay was not running. */
export const MISSED_THRESHOLD_MS = 2 * 60_000;

export function planReminders(
  items: readonly LifeItem[],
  now: Date,
  sessionStartedAt: Date,
  settings: ReminderSettings,
): ReminderPlan {
  const deliver: ReminderDelivery[] = [];
  const missed: { item: LifeItem; at: string }[] = [];
  const quiet = inQuietHours(now, settings.quiet);
  for (const item of items) {
    if (!isReminderPending(item, now, settings)) continue;
    const instant = reminderInstant(item, settings)!;
    const at = instant.toISOString();
    if (instant.getTime() < sessionStartedAt.getTime() - MISSED_THRESHOLD_MS) {
      missed.push({ item, at });
      continue;
    }
    const held = quiet && item.importance !== 'important';
    deliver.push({ item, at, interrupt: item.importance !== 'gentle' && !held, quiet: held });
  }
  return { deliver, missed };
}
