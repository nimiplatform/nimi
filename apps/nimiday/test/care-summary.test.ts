import { describe, expect, it } from 'vitest';
import { createCircle } from '../src/nimiday/domain/defaults.js';
import { createItem } from '../src/nimiday/domain/items.js';
import type { SourceChange } from '../src/nimiday/domain/sources.js';
import { careChanges, careItems } from '../src/nimiday/ui/care-summary.js';

const now = new Date('2026-10-20T04:00:00Z');
const child = createCircle({ kind: 'child', name: 'Snow' }, now);
function change(id: string, patch: Partial<SourceChange> = {}): SourceChange {
  return {
    id, appId: 'nimi.parentos', appName: 'ParentOS', type: 'nimi.parentos.care-reminder.v1',
    nature: 'reminder', title: 'Checkup', summary: null, occurredAt: now.toISOString(),
    todoState: 'open', unread: true, needsAttention: true, openable: true, sourceAvailable: true,
    revision: 1, circleId: null, known: 'parentos-care-reminder',
    groupKey: 'source-a\0child:one', child: { sourceRef: 'source-a', childId: 'one', childName: 'Snow' },
    ...patch,
  };
}

describe('care overview projection', () => {
  it('does not associate equal names; keeps source and child groups separate and accounts for every record', () => {
    const entries = [
      change('a'), change('b'),
      change('other-child', { groupKey: 'source-a\0child:two', child: { sourceRef: 'source-a', childId: 'two', childName: 'Snow' } }),
      change('other-source', { groupKey: 'source-b\0child:one', child: { sourceRef: 'source-b', childId: 'one', childName: 'Snow' } }),
      change('invalid', { child: null, groupKey: null, openable: false }),
      change('linked', { circleId: child.id }),
      change('other-app', { appId: 'other', child: null, groupKey: null }),
    ];
    const result = careChanges(entries, [child]);
    expect(result.pending.map((group) => group.list.map((entry) => entry.id))).toEqual([['a', 'b'], ['other-child'], ['other-source']]);
    expect(result.grouped[0]?.list.map((entry) => entry.id)).toEqual(['linked']);
    expect(result.unknown.map((entry) => entry.id)).toEqual(['invalid']);
    expect(result.other.map((entry) => entry.id)).toEqual(['other-app']);
    expect([...result.pending.flatMap((group) => group.list), ...result.grouped.flatMap((group) => group.list), ...result.unknown, ...result.other]).toHaveLength(entries.length);
  });

  it('moves updates only after explicit association and returns them when cleared', () => {
    expect(careChanges([change('a')], [child]).grouped).toHaveLength(0);
    const associated = careChanges([change('a', { circleId: child.id })], [child]);
    expect(associated.pending).toHaveLength(0);
    expect(associated.grouped[0]?.circle.id).toBe(child.id);
    expect(careChanges([change('a')], [child]).pending).toHaveLength(1);
    expect(careChanges([change('a', { circleId: 'removed' })], [child]).pending).toHaveLength(1);
  });

  it('keeps unavailable and completed records without presenting them as new open work', () => {
    const result = careChanges([
      change('completed', { todoState: 'completed', unread: false }),
      change('unavailable', { sourceAvailable: false, openable: false }),
    ], []);
    expect(result.pending[0]?.list.map((entry) => entry.id)).toEqual(['unavailable', 'completed']);
    expect(result.pending[0]?.list[1]?.todoState).toBe('completed');
  });

  it('previews actual active items, ordered by schedule, without deriving tasks from focus text', () => {
    const item = (title: string, date: string | null, state: 'open' | 'waiting' | 'done' = 'open', circleId = child.id) =>
      createItem({ title, date, state, circleId }, { by: 'user' }, now);
    const entries = [item('Undated', null), item('Later', '2027-07-01'), item('Done', '2026-01-01', 'done'),
      item('Waiting', '2026-10-01', 'waiting'), item('Elsewhere', '2026-01-01', 'open', 'other')];
    expect(careItems(entries, child.id).map((entry) => entry.title)).toEqual(['Waiting', 'Later', 'Undated']);
    expect(careItems([], child.id)).toEqual([]);
  });
});
