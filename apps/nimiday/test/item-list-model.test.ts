import { describe, expect, it } from 'vitest';
import { completeItem, createItem, dropItem, editItem } from '../src/nimiday/domain/items.js';
import { completedItemEntries, matchesItemSearch } from '../src/nimiday/ui/item-list-model.js';

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
});
