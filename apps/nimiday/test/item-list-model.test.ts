import { describe, expect, it } from 'vitest';
import { completeItem, createItem, decideItem, dropItem, editItem, reopenItem } from '../src/nimiday/domain/items.js';
import { completedItemEntries, matchesItemSearch, pendingItemGroups } from '../src/nimiday/ui/item-list-model.js';
import { emptyState } from '../src/nimiday/domain/defaults.js';

describe('finding items and completion records', () => {
  const now = new Date('2026-10-23T10:00:00+08:00');
  const make = () => createItem({ title: 'Buy Coffee', notes: 'decaf beans', place: 'Corner shop', date: '2026-10-24', repeat: { freq: 'weekly' } }, { by: 'user' }, now);

  it('finds words across the title, notes and place without case sensitivity', () => {
    expect(matchesItemSearch(make(), 'COFFEE decaf', [])).toBe(true);
    expect(matchesItemSearch(make(), ' corner ', [])).toBe(true);
    expect(matchesItemSearch(make(), 'tea', [])).toBe(false);
  });

  it('shows each actual completion while preserving the next occurrence', () => {
    const first = completeItem(make(), 'user', now);
    const second = completeItem(first, 'user', new Date('2026-10-23T11:00:00+08:00'));
    expect(second.date).toBe('2026-11-07');
    expect(second.state).toBe('open');
    expect(completedItemEntries([second]).map(entry => entry.date)).toEqual(['2026-10-31', '2026-10-24']);
    const stopped = dropItem(second, 'user', new Date('2026-10-23T12:00:00+08:00'));
    expect(completedItemEntries([stopped]).map(entry => entry.occurrence)).toEqual([false, true, true]);
    expect(completedItemEntries([editItem(first, { repeat: null }, 'user', now)])[0]?.date).toBe('2026-10-24');
  });

  it('does not misrepresent a skipped occurrence as completed or truncate old records', () => {
    const item = make();
    const skipped = { ...item, history: [...item.history, { kind: 'occurrence-skipped' as const, by: 'user' as const, at: now.toISOString(), note: item.date! }] };
    expect(completedItemEntries([skipped])).toEqual([]);
    const items = Array.from({ length: 90 }, (_, i) => ({ ...completeItem(createItem({ title: `Done ${i}` }, { by: 'user' }, now), 'user', now), id: `item-${i}` }));
    expect(completedItemEntries(items)).toHaveLength(90);
  });

  it('keeps distant repetitions reachable and separates decisions and completed work from pending work', () => {
    const future = createItem({ title: 'Annual checkup', date: '2027-07-01', repeat: { freq: 'yearly' } }, { by: 'user' }, now);
    const today = createItem({ title: 'Today', date: '2026-10-23' }, { by: 'user' }, now);
    const waiting = { ...make(), state: 'waiting' as const };
    const done = completeItem(today, 'user', now);
    const undated = createItem({ title: 'Plan later' }, { by: 'user' }, now);
    const groups = pendingItemGroups({ ...emptyState('en', now), items: [future, waiting, done, undated] }, now);
    expect(groups.pending.map(item => item.id)).toEqual([future.id, undated.id]);
    expect(groups.later).toEqual([future]);
    expect(groups.undated).toEqual([undated]);
    expect(groups.days).toEqual([]);
  });

  it('shows a timed overdue occurrence once while retaining future repeat previews', () => {
    const item = createItem({ title: 'Medicine', date: '2026-10-23', time: '09:00', repeat: { freq: 'daily' } }, { by: 'user' }, now);
    const groups = pendingItemGroups({ ...emptyState('en', now), items: [item] }, now);
    expect(groups.overdue).toEqual([item]);
    expect(groups.days.some(day => day.date === '2026-10-23')).toBe(false);
    expect(groups.days).toHaveLength(13);
    expect(groups.days.every(day => day.entries.every(entry => entry.kind === 'item' && entry.projected))).toBe(true);
  });

  it('returns a decided or cancelled question to waiting, preserves its history and permits a different choice', () => {
    const question = createItem({ title: 'Choose a plan', decision: { question: 'Which plan?', options: ['A', 'B'], choice: null } }, { by: 'user' }, now);
    const decided = decideItem(question, 'A', now);
    expect(completedItemEntries([decided])).toHaveLength(1);
    for (const closed of [decided, dropItem(question, 'user', now)]) {
      const reopened = reopenItem(closed, 'user', now);
      expect(reopened).toMatchObject({ state: 'waiting', decision: { choice: null }, completedAt: null });
      expect(reopened.history.slice(0, -1)).toEqual(closed.history);
      expect(pendingItemGroups({ ...emptyState('en', now), items: [reopened] }, now).pending).toEqual([]);
      expect(completedItemEntries([reopened])).toEqual([]);
      expect(decideItem(reopened, 'B', now)).toMatchObject({ state: 'done', decision: { choice: 'B' } });
    }
  });
});
