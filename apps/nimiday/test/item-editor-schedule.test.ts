import { describe, expect, it } from 'vitest';
import { isEditorScheduleValid, nextScheduleMinute, updateEditorSchedule } from '../src/nimiday/ui/item-editor-schedule.js';

const now = new Date('2026-10-19T14:30:20+08:00');
const timed = { date: '2026-10-19', time: '14:31', allDay: false };

describe('item editor scheduling', () => {
  it('rejects new past dates and elapsed times, including elapsed seconds in the current minute', () => {
    expect(isEditorScheduleValid({ ...timed, date: '2026-10-18' }, null, now)).toBe(false);
    expect(isEditorScheduleValid({ ...timed, time: '14:30' }, null, now)).toBe(false);
    expect(isEditorScheduleValid(timed, null, now)).toBe(true);
    expect(isEditorScheduleValid({ ...timed, date: '2026-10-20', time: '00:00' }, null, now)).toBe(true);
  });

  it('allows today all day and no date, but not an all-day date in the past', () => {
    expect(isEditorScheduleValid({ ...timed, allDay: true }, null, now)).toBe(true);
    expect(isEditorScheduleValid({ ...timed, date: '' }, null, now)).toBe(true);
    expect(isEditorScheduleValid({ ...timed, date: '2026-10-18', allDay: true }, null, now)).toBe(false);
  });

  it('preserves unchanged overdue schedules while rejecting a different past schedule', () => {
    const original = { date: '2026-10-14', time: '15:00' };
    const schedule = { ...original, allDay: false };
    expect(isEditorScheduleValid(schedule, original, now)).toBe(true);
    expect(isEditorScheduleValid({ ...schedule, time: '16:00' }, original, now)).toBe(false);
    expect(isEditorScheduleValid({ ...schedule, date: '2026-10-15' }, original, now)).toBe(false);
    expect(isEditorScheduleValid({ ...schedule, allDay: true }, original, now)).toBe(false);
    expect(isEditorScheduleValid(timed, original, now)).toBe(true);
    expect(isEditorScheduleValid({ ...schedule, date: '' }, original, now)).toBe(true);
    expect(isEditorScheduleValid({ ...schedule, allDay: true }, { ...original, time: null }, now)).toBe(true);
  });

  it('rechecks an elapsed draft against the save clock while retaining an unchanged existing item', () => {
    const later = new Date('2026-10-19T14:31:01+08:00');
    expect(isEditorScheduleValid(timed, null, now)).toBe(true);
    expect(isEditorScheduleValid(timed, null, later)).toBe(false);
    expect(isEditorScheduleValid(timed, { date: timed.date, time: timed.time }, later)).toBe(true);
  });

  it('rounds the earliest selectable minute across midnight and year boundaries', () => {
    expect(nextScheduleMinute(now).toISOString()).toBe('2026-10-19T06:31:00.000Z');
    expect(nextScheduleMinute(new Date('2026-10-19T14:30:00+08:00')).toISOString()).toBe('2026-10-19T06:30:00.000Z');
    const midnight = new Date('2026-12-31T23:59:30+08:00');
    expect(nextScheduleMinute(midnight).toISOString()).toBe('2026-12-31T16:00:00.000Z');
    expect(isEditorScheduleValid({ date: '2026-12-31', time: '23:59', allDay: false }, null, midnight)).toBe(false);
    expect(isEditorScheduleValid({ date: '2027-01-01', time: '00:00', allDay: false }, null, midnight)).toBe(true);
  });

  it('adjusts a stale default time only on deliberate scheduling edits and preserves other fields', () => {
    const current = { date: '2026-10-14', time: '09:00', allDay: false, title: 'Call' };
    expect(updateEditorSchedule(current, { date: '2026-10-19' }, now)).toEqual({ ...current, date: '2026-10-19', time: '14:31' });
    expect(current.time).toBe('09:00');
    expect(updateEditorSchedule(current, { date: '2026-10-20' }, now).time).toBe('09:00');
    expect(updateEditorSchedule({ ...current, date: '2026-10-19', allDay: true }, { allDay: false }, now).time).toBe('14:31');
  });
});
