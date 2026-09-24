import { describe, expect, it } from 'vitest';
import { completeItem, createItem, editItem, markReminder, snoozeItem } from '../src/nimiday/domain/items.js';
import {
  inQuietHours,
  isOverdue,
  isReminderPending,
  quietHoursEnd,
  reminderInstant,
  snoozeOptions,
} from '../src/nimiday/domain/reminders.js';
import { rhythmDue, handledMarkForEnable, nextRhythmOccurrence } from '../src/nimiday/domain/rhythms.js';
import type { Rhythm } from '../src/nimiday/domain/types.js';

const settings = { allDayRemindTime: '08:30', quiet: { enabled: true, start: '22:00', end: '07:30' } };
const at = (value: string) => new Date(value);

describe('reminders', () => {
  it('reminds appointments an hour early by default', () => {
    const item = createItem({ title: '带小米打疫苗', kind: 'appointment', date: '2026-09-25', time: '09:00' }, { by: 'user' }, at('2026-09-24T10:00:00+08:00'));
    expect(reminderInstant(item, settings)?.toISOString()).toBe(at('2026-09-25T08:00:00+08:00').toISOString());
    expect(isReminderPending(item, at('2026-09-25T07:59:00+08:00'), settings)).toBe(false);
    expect(isReminderPending(item, at('2026-09-25T08:00:00+08:00'), settings)).toBe(true);
    const reminded = markReminder(item, reminderInstant(item, settings)!.toISOString(), 'reminded', at('2026-09-25T08:00:05+08:00'));
    expect(isReminderPending(reminded, at('2026-09-25T08:10:00+08:00'), settings)).toBe(false);
  });

  it('reminds all-day items at the morning time', () => {
    const item = createItem({ title: '交物业费', date: '2026-09-26' }, { by: 'user' }, at('2026-09-24T10:00:00+08:00'));
    expect(item.time).toBeNull();
    expect(reminderInstant(item, settings)?.toISOString()).toBe(at('2026-09-26T08:30:00+08:00').toISOString());
    expect(isOverdue(item, at('2026-09-26T23:00:00+08:00'))).toBe(false);
    expect(isOverdue(item, at('2026-09-27T00:01:00+08:00'))).toBe(true);
  });

  it('lets a snooze replace the rule and resets on a new time', () => {
    const now = at('2026-09-24T10:00:00+08:00');
    const item = createItem({ title: '给妈妈打电话', date: '2026-09-24', time: '10:00' }, { by: 'user' }, now);
    const snoozed = snoozeItem(item, at('2026-09-24T11:00:00+08:00').toISOString(), now);
    expect(reminderInstant(snoozed, settings)?.toISOString()).toBe(at('2026-09-24T11:00:00+08:00').toISOString());
    const moved = editItem(snoozed, { time: '15:00' }, 'user', now);
    expect(moved.snoozedUntil).toBeNull();
    expect(reminderInstant(moved, settings)?.toISOString()).toBe(at('2026-09-24T15:00:00+08:00').toISOString());
  });

  it('advances repeating items instead of closing them', () => {
    const now = at('2026-09-25T08:00:00+08:00');
    const item = createItem({ title: '倒垃圾', date: '2026-09-25', time: '20:00', repeat: { freq: 'weekly', weekdays: [2, 5] } }, { by: 'user' }, now);
    const done = completeItem(item, 'user', now);
    expect(done.state).toBe('open');
    expect(done.date).toBe('2026-09-29');
    expect(done.history.at(-1)).toMatchObject({ kind: 'occurrence-done', note: '2026-09-25' });
    const once = completeItem(createItem({ title: '买牛奶' }, { by: 'user' }, now), 'user', now);
    expect(once.state).toBe('done');
  });

  it('treats quiet hours that wrap past midnight', () => {
    expect(inQuietHours(at('2026-09-24T23:30:00+08:00'), settings.quiet)).toBe(true);
    expect(inQuietHours(at('2026-09-25T07:00:00+08:00'), settings.quiet)).toBe(true);
    expect(inQuietHours(at('2026-09-25T07:30:00+08:00'), settings.quiet)).toBe(false);
    expect(inQuietHours(at('2026-09-25T12:00:00+08:00'), settings.quiet)).toBe(false);
    expect(quietHoursEnd(at('2026-09-24T23:30:00+08:00'), settings.quiet).toISOString()).toBe(at('2026-09-25T07:30:00+08:00').toISOString());
    expect(inQuietHours(at('2026-09-24T23:30:00+08:00'), { ...settings.quiet, enabled: false })).toBe(false);
  });

  it('offers evening snooze only when it is still ahead', () => {
    const morning = snoozeOptions(at('2026-09-24T09:00:00+08:00'), settings).map((option) => option.choice);
    expect(morning).toEqual(['ten-minutes', 'one-hour', 'this-evening', 'tomorrow-morning']);
    const late = snoozeOptions(at('2026-09-24T19:30:00+08:00'), settings).map((option) => option.choice);
    expect(late).toEqual(['ten-minutes', 'one-hour', 'tomorrow-morning']);
  });
});

describe('rhythms', () => {
  const base: Rhythm = {
    id: 'rhythm_1',
    skillId: 'morning-care',
    name: '晨间照看',
    enabled: true,
    schedule: { days: 'weekdays', weekdays: [], time: '07:40' },
    start: 'ask',
    notify: true,
    handledFor: null,
    createdAt: at('2026-09-20T12:00:00+08:00').toISOString(),
    updatedAt: at('2026-09-20T12:00:00+08:00').toISOString(),
  };

  const openedEarly = at('2026-09-24T06:00:00+08:00');

  it('starts what comes due while NimiDay runs, within the on-time window', () => {
    expect(rhythmDue(base, at('2026-09-24T07:45:00+08:00'), openedEarly)).toMatchObject({ kind: 'on-time' });
    // Running all along, but past the window (the computer slept through it).
    expect(rhythmDue(base, at('2026-09-24T10:00:00+08:00'), openedEarly)).toMatchObject({ kind: 'missed', reason: 'late' });
    const handled = { ...base, handledFor: at('2026-09-24T07:40:00+08:00').toISOString() };
    expect(rhythmDue(handled, at('2026-09-24T10:00:00+08:00'), openedEarly)).toEqual({ kind: 'none' });
  });

  it('never starts what came due while NimiDay was closed, however recent', () => {
    // Opened five minutes, or just twelve seconds, after the routine's time: it came due while closed.
    expect(rhythmDue(base, at('2026-09-24T07:45:00+08:00'), at('2026-09-24T07:45:00+08:00'))).toMatchObject({ kind: 'missed', reason: 'closed' });
    expect(rhythmDue(base, at('2026-09-24T07:40:30+08:00'), at('2026-09-24T07:40:12+08:00'))).toMatchObject({ kind: 'missed', reason: 'closed' });
    // Opened ten seconds before it: it comes due while NimiDay runs.
    expect(rhythmDue(base, at('2026-09-24T07:40:05+08:00'), at('2026-09-24T07:39:50+08:00'))).toMatchObject({ kind: 'on-time' });
  });

  it('skips weekend days and does not owe occurrences before it was switched on', () => {
    // 2026-09-26 is a Saturday: the latest weekday occurrence is Friday.
    const due = rhythmDue(base, at('2026-09-26T09:00:00+08:00'), at('2026-09-26T08:30:00+08:00'));
    expect(due).toMatchObject({ kind: 'missed', reason: 'closed' });
    const fresh = { ...base, createdAt: at('2026-09-24T09:00:00+08:00').toISOString() };
    expect(rhythmDue(fresh, at('2026-09-24T09:05:00+08:00'), openedEarly)).toEqual({ kind: 'none' });
    expect(handledMarkForEnable(base.schedule, at('2026-09-24T09:00:00+08:00'))).toBe(at('2026-09-24T07:40:00+08:00').toISOString());
    expect(nextRhythmOccurrence(base.schedule, at('2026-09-25T08:00:00+08:00'))?.toISOString()).toBe(at('2026-09-28T07:40:00+08:00').toISOString());
  });
});
