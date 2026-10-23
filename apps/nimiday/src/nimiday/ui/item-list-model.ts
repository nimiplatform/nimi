import { isLocalDate } from '../domain/time.js';
import { addDays, toLocalDate } from '../domain/time.js';
import { isOverdue } from '../domain/reminders.js';
import { buildAgenda } from '../domain/today.js';
import type { CareCircle, DayState, LifeItem } from '../domain/types.js';

/** Pending work includes every current occurrence, even beyond the agenda horizon. */
// @nimi-authority: definition.nimi.nimiday.assistant.business
export function pendingItemGroups(state: DayState, now: Date) {
  const today = toLocalDate(now);
  const horizon = addDays(today, 13);
  const pending = state.items.filter(item => item.state === 'open');
  const bySchedule = (a: LifeItem, b: LifeItem) => `${a.date ?? ''} ${a.time ?? ''}`.localeCompare(`${b.date ?? ''} ${b.time ?? ''}`);
  const overdue = pending.filter(item => isOverdue(item, now)).sort(bySchedule);
  const overdueIds = new Set(overdue.map(item => item.id));
  const days = buildAgenda({ ...state, items: pending, rhythms: [] }, today, 14)
    .map(day => ({ ...day, entries: day.entries.filter(entry => entry.kind === 'item' && !entry.done && (entry.projected || !overdueIds.has(entry.item.id))) }))
    .filter(day => day.entries.length > 0);
  return {
    pending,
    overdue,
    days,
    later: pending.filter(item => item.date !== null && item.date > horizon).sort(bySchedule),
    undated: pending.filter(item => item.date === null).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
  };
}

// @nimi-authority: definition.nimi.nimiday.assistant.business
export function matchesItemSearch(item: LifeItem, query: string, circles: readonly CareCircle[]): boolean {
  const words = query.trim().toLocaleLowerCase().split(/\s+/u).filter(Boolean);
  const circle = circles.find(value => value.id === item.circleId);
  const text = [item.title, item.notes, item.place, circle?.name, item.source?.title, item.decision?.question].filter(Boolean).join(' ').toLocaleLowerCase();
  return words.every(word => text.includes(word));
}

/** Display existing completion evidence without closing the next repetition. */
export function completedItemEntries(items: readonly LifeItem[]) {
  return items.flatMap(item => {
    const occurrences = item.history.flatMap((event, index) => event.kind === 'occurrence-done' && event.note && isLocalDate(event.note)
      ? [{ key: `${item.id}:${index}`, item, date: event.note, at: event.at, occurrence: true }]
      : []);
    return item.state === 'done' || item.state === 'dropped'
      ? [...occurrences, { key: item.id, item, date: item.date, at: item.completedAt ?? item.updatedAt, occurrence: false }]
      : occurrences;
  }).sort((a, b) => b.at.localeCompare(a.at));
}
