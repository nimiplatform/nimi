import { describe, expect, it } from 'vitest';
import { emptyState } from '../src/nimiday/domain/defaults.js';
import { createItem, completeItem } from '../src/nimiday/domain/items.js';
import { buildSourceAttention, selectSourceEntries, sourceEntries } from '../src/nimiday/domain/source-attention.js';
import { followedChanges, sourceLinkFor, sourceViewKey, type ActivityRecordLike, type SourceChange } from '../src/nimiday/domain/sources.js';
import { normalizeProfile } from '../src/nimiday/store/normalize.js';

const now = new Date('2026-10-23T10:00:00Z');
const state = () => emptyState('zh', now);
function source(id: string, patch: Partial<SourceChange> = {}): SourceChange {
  return { id, appId: 'app-a', appName: 'App A', type: 'reminder', nature: 'reminder', title: id, summary: null,
    occurredAt: '2026-10-23T09:00:00Z', todoState: 'open', unread: true, needsAttention: false,
    openable: true, sourceAvailable: true, revision: 1, circleId: null, known: null,
    groupKey: null, objectKey: `source-a:${id}`, ...patch };
}

describe('source attention', () => {
  it('bounds a burst from many apps and spreads equal-tier slots without dropping omitted items', () => {
    const changes = Array.from({ length: 280 }, (_, i) => source(`item-${i}`, { appId: `app-${i % 6}` }));
    const model = buildSourceAttention(state(), changes, now);
    expect(model.units).toHaveLength(3);
    expect(new Set(model.units.map(unit => unit.entries[0]!.change.appId)).size).toBe(3);
    expect(model.attentionCount).toBe(280);
    expect(selectSourceEntries(model.entries, { mode: 'pending' })).toHaveLength(280);
    const updated = buildSourceAttention(state(), changes.map(change => ({ ...change, revision: 99, occurredAt: now.toISOString() })), now);
    expect(updated.units.map(unit => unit.key)).toEqual(model.units.map(unit => unit.key));
  });

  it('does not trade an explicit attention tier for publisher diversity or infer urgency from title', () => {
    const changes = [source('tomorrow', { appId: 'app-b', title: 'URGENT today deadline' }),
      ...Array.from({ length: 4 }, (_, i) => source(`a-${i}`, { needsAttention: true }))];
    expect(buildSourceAttention(state(), changes, now).units.map(unit => unit.entries[0]!.change.appId)).toEqual(['app-a', 'app-a', 'app-a']);
  });

  it('groups verified publisher identities, never equal names or a local person alone', () => {
    const changes = [source('a', { groupKey: 'source-a\0child:1' }), source('b', { groupKey: 'source-a\0child:1' }),
      source('c', { groupKey: 'source-b\0child:1' }), source('d'), source('e')];
    const model = buildSourceAttention(state(), changes, now);
    expect(model.allUnits.map(unit => unit.entries.length).sort()).toEqual([1, 1, 1, 2]);
    const group = model.allUnits.find(unit => unit.entries.length === 2)!;
    expect(selectSourceEntries(model.entries, { mode: 'pending', unitKey: group.key }).map(entry => entry.change.id)).toEqual(['a', 'b']);
  });

  it('keeps association and unread recent dynamics to one summary each, and keeps old open tasks', () => {
    const changes = [source('old', { occurredAt: '2020-01-01T00:00:00Z' }),
      ...Array.from({ length: 80 }, (_, i) => source(`unlinked-${i}`, { appId: 'nimi.parentos' })),
      source('news', { nature: 'record', todoState: null }), source('read', { nature: 'record', todoState: null, unread: false }),
      source('cancelled', { todoState: 'cancelled' }), source('old-news', { nature: 'record', todoState: null, occurredAt: '2020-01-01T00:00:00Z' })];
    const model = buildSourceAttention(state(), changes, now);
    expect(model.units[0]!.entries[0]!.change.id).toBe('old');
    expect(model.association).toHaveLength(80);
    expect(model.dynamics.map(entry => entry.change.id)).toEqual(['news', 'cancelled']);
    expect(model.openCount).toBe(81);
  });

  it('persists hide by stable source object across revisions while full lists can restore it', () => {
    const record: ActivityRecordLike = { activityId: 'v1', source: { kind: 'app', appId: 'app-a', sourceRef: 'source-a', displayName: 'A', available: true },
      revision: 1, kind: 'todo', todoState: 'open', attention: true, title: 'A', summary: null, objectRef: 'a', type: 'todo', occurredAt: now.toISOString(),
      agent: null, userView: { unread: true, needsAttention: true } };
    const profile = { ...state().profile, sources: [{ appId: 'app-a', enabled: true, circleId: null }] };
    const first = followedChanges([record], profile, [])[0]!;
    const hidden = normalizeProfile({ ...profile, sourceViews: [{ key: sourceViewKey(first), hidden: true, snoozedUntil: null, reviewedSignature: null }] });
    const updated = { ...record, activityId: 'v2', revision: 2 };
    expect(followedChanges([updated], hidden, [])).toHaveLength(0);
    const entries = sourceEntries({ ...state(), profile: hidden }, followedChanges([updated], hidden, [], true), now);
    expect(selectSourceEntries(entries, { mode: 'hidden' })[0]!.change.id).toBe('v2');
    expect(selectSourceEntries(entries, { mode: 'all' })).toHaveLength(1);
  });

  it('suppresses snoozed items until the chosen time without resurrecting cancelled sources', () => {
    const change = source('a');
    const snoozed = { ...state(), profile: { ...state().profile, sourceViews: [{ key: sourceViewKey(change), hidden: false, snoozedUntil: '2026-10-23T11:00:00Z', reviewedSignature: null }] } };
    expect(buildSourceAttention(snoozed, [change], now).units).toHaveLength(0);
    expect(selectSourceEntries(sourceEntries(snoozed, [change], now), { mode: 'snoozed' })).toHaveLength(1);
    expect(buildSourceAttention(snoozed, [change], new Date('2026-10-23T11:00:00Z')).units).toHaveLength(1);
    expect(buildSourceAttention(snoozed, [{ ...change, todoState: 'cancelled' }], new Date('2026-10-23T11:00:00Z')).units).toHaveLength(0);
  });

  it('exits on arrangement and returns for changed content, deletion, ending and terminal impact', () => {
    const change = source('a');
    const arrangement = createItem({ title: 'Arrange A', source: sourceLinkFor(change) }, { by: 'user' }, now);
    const arranged = { ...state(), items: [arrangement] };
    expect(buildSourceAttention(arranged, [change], now).units).toHaveLength(0);
    expect(buildSourceAttention(arranged, [{ ...change, revision: 2 }], now).units).toHaveLength(0);
    expect(buildSourceAttention(arranged, [{ ...change, unread: false, needsAttention: true }], now).units).toHaveLength(0);
    expect(buildSourceAttention(arranged, [{ ...change, summary: 'Changed details' }], now).units[0]!.entries[0]!.reason).toBe('changed');
    expect(buildSourceAttention(state(), [change], now).units).toHaveLength(1);
    expect(buildSourceAttention({ ...arranged, items: [completeItem(arrangement, 'user', now)] }, [change], now).units[0]!.entries[0]!.reason).toBe('check');
    const terminal = { ...change, todoState: 'cancelled' as const };
    const entry = sourceEntries(arranged, [terminal], now)[0]!;
    expect(entry.reason).toBe('terminal');
    const reviewed = { ...arranged, profile: { ...arranged.profile, sourceViews: [{ key: sourceViewKey(change), hidden: false, snoozedUntil: null, reviewedSignature: entry.reviewSignature }] } };
    expect(buildSourceAttention(reviewed, [terminal], now).units).toHaveLength(0);
    expect(terminal.todoState).toBe('cancelled');
  });

  it('reading never closes an open reminder and ended care stays out of Today', () => {
    expect(buildSourceAttention(state(), [source('read', { unread: false })], now).units).toHaveLength(1);
    const ended = { ...state(), circles: [{ id: 'c', kind: 'child' as const, name: 'Child', watch: '', focus: [], status: 'ended' as const, createdAt: now.toISOString(), updatedAt: now.toISOString() }] };
    expect(buildSourceAttention(ended, [source('a', { circleId: 'c' })], now).units).toHaveLength(0);
    expect(selectSourceEntries(sourceEntries(ended, [source('a', { circleId: 'c' })], now), { mode: 'all' })).toHaveLength(1);
  });
});
