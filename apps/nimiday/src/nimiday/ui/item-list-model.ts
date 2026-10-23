import { isLocalDate } from '../domain/time.js';
import type { CareCircle, LifeItem } from '../domain/types.js';

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
