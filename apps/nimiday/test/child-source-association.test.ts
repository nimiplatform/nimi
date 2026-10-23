import { describe, expect, it } from 'vitest';
import { createCircle, DEFAULT_PROFILE } from '../src/nimiday/domain/defaults.js';
import { parentOSChildIdentity, sourceApps, sourceGroupKey, toSourceChange, type ActivityRecordLike } from '../src/nimiday/domain/sources.js';
import { createDayStore } from '../src/nimiday/store/day-store.js';
import { dayActions } from '../src/nimiday/store/actions.js';
import type { JsonDocumentStore } from '../src/nimiday/store/persistence.js';
import { onboardingSteps } from '../src/nimiday/ui/onboarding-steps.js';

const now = new Date('2026-10-20T04:00:00Z');
const snow = createCircle({ kind: 'child', name: 'Snow' }, now);
const zane = createCircle({ kind: 'child', name: 'Zane' }, now);
const circles = [snow, zane];

function reminder(childId = 'child-snow', childName = 'Snow', sourceRef = 'src_parentos'): ActivityRecordLike {
  return {
    activityId: `${sourceRef}-${childId}`, source: { kind: 'app', appId: 'nimi.parentos', sourceRef, displayName: 'ParentOS', available: true },
    key: `care-reminder:${childId}:PO-REM-CHK-010:2`,
    objectRef: `reminder:${childId}:PO-REM-CHK-010:2`,
    type: 'nimi.parentos.care-reminder.v1', kind: 'todo', todoState: 'open',
    data: { childId, childName, ruleId: 'PO-REM-CHK-010', repeatIndex: 2, windowStart: '2026-10-01', windowEnd: '2027-09-30' },
    groupRef: 'opaque-shared-value', revision: 1, attention: true, title: '年度健康体检', summary: null,
    occurredAt: now.toISOString(), agent: null, userView: { unread: true, needsAttention: true },
  };
}

const snowRecord = reminder();
const zaneRecord = reminder('child-zane', 'Zane');
const profile = {
  ...DEFAULT_PROFILE,
  sources: [{ appId: 'nimi.parentos', enabled: true, circleId: snow.id }],
  sourceGroups: [
    { key: sourceGroupKey(snowRecord)!, appId: 'nimi.parentos', circleId: snow.id },
    { key: sourceGroupKey(zaneRecord)!, appId: 'nimi.parentos', circleId: zane.id },
  ],
};

describe('ParentOS source and child association', () => {
  it('repairs a profile write interrupted after the circle was stored without duplicating that child', async () => {
    const saved = new Map<string, unknown>();
    let failProfile = true;
    const documents: JsonDocumentStore = {
      read: async path => structuredClone(saved.get(path)),
      write: async (path, value) => {
        if (path.includes('profile') && failProfile) throw new Error('interrupted');
        saved.set(path, structuredClone(value));
      },
      remove: async path => { saved.delete(path); },
    };
    const store = createDayStore(documents, { language: () => 'zh' });
    await store.load();
    const group = sourceApps([snowRecord])[0]!.groups[0]!;
    const child = dayActions(store).addSourceChild(group)!;
    expect((await store.persist()).ok).toBe(false);
    store.close();
    failProfile = false;
    const resumed = createDayStore(documents, { language: () => 'zh' });
    await resumed.load();
    expect(resumed.getSnapshot().state.circles).toHaveLength(1);
    expect(resumed.getSnapshot().state.profile.sourceGroups).toHaveLength(0);
    expect(dayActions(resumed).addSourceChild(group)?.id).toBe(child.id);
    expect(resumed.getSnapshot().state.circles).toHaveLength(1);
    expect((await resumed.persist()).ok).toBe(true);
    resumed.close();
  });
  // @nimi-authority: rule.nimi.nimiday.assistant.child-source-addition
  it('adds and links in one state update, deduplicates repeat clicks, and preserves identity through reload', async () => {
    const saved = new Map<string, unknown>();
    const documents: JsonDocumentStore = {
      read: async path => structuredClone(saved.get(path)),
      write: async (path, value) => { saved.set(path, structuredClone(value)); },
      remove: async path => { saved.delete(path); },
    };
    const store = createDayStore(documents, { language: () => 'zh', now: () => now });
    await store.load();
    const actions = dayActions(store, () => now);
    const group = sourceApps([snowRecord])[0]!.groups[0]!;
    actions.setSourcePreference({ appId: 'nimi.parentos', enabled: false, circleId: null });
    const snapshots: boolean[] = [];
    const unsubscribe = store.subscribe(() => {
      const { state } = store.getSnapshot();
      snapshots.push(state.circles.length === state.profile.sourceGroups.length);
    });
    const created = actions.addSourceChild(group)!;
    expect(actions.addSourceChild(group)?.id).toBe(created.id);
    expect(snapshots.every(Boolean)).toBe(true);
    unsubscribe();
    expect(store.getSnapshot().state.circles).toHaveLength(1);
    expect(await store.persist()).toEqual({ ok: true });
    const reloaded = createDayStore(documents, { language: () => 'zh', now: () => now });
    await reloaded.load();
    const state = reloaded.getSnapshot().state;
    expect(state.profile.sources.find(source => source.appId === 'nimi.parentos')?.enabled).toBe(true);
    expect(toSourceChange(snowRecord, state.profile, state.circles)?.circleId).toBe(created.id);
    const sameName = sourceApps([reminder('different-child', 'Snow')])[0]!.groups[0]!;
    expect(dayActions(reloaded, () => now).addSourceChild(sameName)?.id).not.toBe(created.id);
    await reloaded.flush();
  });

  it('keeps failed saves retryable and refuses unavailable, mismatched and closed-session additions', async () => {
    let fail = true;
    const documents: JsonDocumentStore = {
      read: async () => undefined,
      write: async () => { if (fail) throw new Error('disk unavailable'); },
      remove: async () => {},
    };
    const store = createDayStore(documents, { language: () => 'zh', now: () => now });
    await store.load();
    const actions = dayActions(store, () => now);
    const group = sourceApps([snowRecord])[0]!.groups[0]!;
    expect(actions.addSourceChild({ ...group, available: false })).toBeNull();
    expect(actions.addSourceChild({ ...group, key: 'wrong-source' })).toBeNull();
    expect(actions.addSourceChild(group, 'missing-circle')).toBeNull();
    const created = actions.addSourceChild(group)!;
    expect((await store.persist()).ok).toBe(false);
    expect(store.getSnapshot().unsaved).toBe(true);
    fail = false;
    expect(actions.addSourceChild(group)?.id).toBe(created.id);
    expect((await store.persist()).ok).toBe(true);
    expect(store.getSnapshot().state.circles).toHaveLength(1);
    store.close();
    expect(actions.addSourceChild(group)).toBeNull();
  });

  it('links a user-selected existing child without making a duplicate or guessing from names', async () => {
    const store = createDayStore({ read: async () => undefined, write: async () => {}, remove: async () => {} }, { language: () => 'zh' });
    await store.load();
    const actions = dayActions(store);
    const existing = actions.addCircle({ kind: 'child', name: 'Local name' });
    const group = sourceApps([snowRecord])[0]!.groups[0]!;
    expect(actions.addSourceChild(group, existing.id)?.id).toBe(existing.id);
    expect(store.getSnapshot().state.circles).toEqual([existing]);
    expect(store.getSnapshot().state.profile.sourceGroups[0]?.circleId).toBe(existing.id);
    await store.flush();
  });

  it('defers first-run source choices and refuses stale selections before creating any circles', async () => {
    const store = createDayStore({ read: async () => undefined, write: async () => {}, remove: async () => {} }, { language: () => 'zh' });
    await store.load();
    const group = sourceApps([snowRecord])[0]!.groups[0]!;
    const drafts = [{ key: group.key, kind: 'child' as const, name: 'Snow', sourceKey: group.key }];
    const steps = onboardingSteps(dayActions(store));
    steps.continueFromCircles(drafts);
    expect(store.getSnapshot().state.circles).toHaveLength(0);
    expect(steps.finish(drafts, [])).toBe(false);
    expect(store.getSnapshot().state.profile.onboarded).toBe(false);
    expect(steps.finish(drafts, [group])).toBe(true);
    expect(store.getSnapshot().state.circles).toHaveLength(1);
    expect(store.getSnapshot().state.profile.sourceGroups).toHaveLength(1);
    await store.flush();
  });
  it('never defaults an unassociated child to the first child, an App choice or an old opaque group', () => {
    const unassociated = {
      ...profile,
      sourceGroups: [{ key: 'src_parentos\0opaque-shared-value', appId: 'nimi.parentos', circleId: snow.id }],
    };
    for (const record of [snowRecord, zaneRecord]) {
      expect(toSourceChange(record, unassociated, circles)).toMatchObject({ circleId: null, openable: true });
    }
  });

  it('separates same-title reminders, equal names and different source registrations', () => {
    expect(toSourceChange(snowRecord, profile, circles)?.circleId).toBe(snow.id);
    expect(toSourceChange(zaneRecord, profile, circles)?.circleId).toBe(zane.id);
    expect(toSourceChange(reminder('child-zane', 'Snow'), profile, circles)).toMatchObject({ circleId: zane.id, child: { childId: 'child-zane', childName: 'Snow' } });
    expect(toSourceChange(reminder('child-snow', 'Snow', 'src_other'), profile, circles)?.circleId).toBeNull();
  });

  it('clears association without fallback and rejects missing, ended or non-child circles and wrong App ownership', () => {
    for (const circleId of [null, 'missing', 'adult', 'ended']) {
      const changed = { ...profile, sourceGroups: [{ ...profile.sourceGroups[0]!, circleId }] };
      expect(toSourceChange(snowRecord, changed, [
        ...circles, { ...snow, id: 'adult', kind: 'self' }, { ...snow, id: 'ended', status: 'ended' },
      ])?.circleId).toBeNull();
    }
    expect(toSourceChange(snowRecord, { ...profile, sourceGroups: [{ ...profile.sourceGroups[0]!, appId: 'other' }] }, circles)?.circleId).toBeNull();
  });

  it.each([
    { data: undefined },
    { data: { ...(snowRecord.data as object), childId: 'child-zane' } },
    { data: { ...(snowRecord.data as object), childName: '' } },
    { data: { ...(snowRecord.data as object), repeatIndex: 1 } },
    { data: { ...(snowRecord.data as object), ruleId: 'PO-REM-VIS-002' } },
    { data: { ...(snowRecord.data as object), windowStart: '2026-02-30' } },
    { data: { ...(snowRecord.data as object), windowEnd: '2025-01-01' } },
    { source: { ...snowRecord.source, sourceRef: null } },
    { key: 'care-reminder:child-zane:PO-REM-CHK-010:2' },
    { objectRef: 'reminder:child-zane:PO-REM-CHK-010:2' },
    { type: 'nimi.parentos.growth-record-reminder.v1' },
  ])('leaves incomplete or conflicting identity unassociated and non-openable: %j', override => {
    const record = { ...snowRecord, ...override };
    expect(parentOSChildIdentity(record)).toBeNull();
    expect(toSourceChange(record, profile, circles)).toMatchObject({ circleId: null, groupKey: null, child: null, openable: false });
    expect(sourceApps([record])[0]?.ungrouped.count).toBe(1);
  });

  it('offers even a single child group and displays the newest published name independent of input order', () => {
    const renamed = { ...reminder('child-snow', 'Snow renamed'), revision: 2 };
    for (const records of [[snowRecord, renamed], [renamed, snowRecord]]) {
      const app = sourceApps(records)[0]!;
      expect(app.groups).toHaveLength(1);
      expect(app.groups[0]).toMatchObject({ key: sourceGroupKey(snowRecord), child: { childId: 'child-snow', childName: 'Snow renamed', sourceRef: 'src_parentos' } });
    }
  });

  it('persists explicit child associations through reload using the existing sourceGroups storage', async () => {
    const saved = new Map<string, unknown>();
    const documents: JsonDocumentStore = {
      read: async path => structuredClone(saved.get(path)),
      write: async (path, value) => { saved.set(path, structuredClone(value)); },
      remove: async path => { saved.delete(path); },
    };
    const store = createDayStore(documents, { language: () => 'zh', now: () => now });
    await store.load();
    const actions = dayActions(store, () => now);
    for (const entry of profile.sourceGroups) actions.setSourceGroup(entry);
    await store.flush();
    const reloaded = createDayStore(documents, { language: () => 'zh', now: () => now });
    await reloaded.load();
    expect(toSourceChange(snowRecord, reloaded.getSnapshot().state.profile, circles)?.circleId).toBe(snow.id);
    expect(toSourceChange(zaneRecord, reloaded.getSnapshot().state.profile, circles)?.circleId).toBe(zane.id);
  });
});
