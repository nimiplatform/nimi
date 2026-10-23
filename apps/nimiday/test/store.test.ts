import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_PROFILE, createCircle } from '../src/nimiday/domain/defaults.js';
import { createItem } from '../src/nimiday/domain/items.js';
import { followedChanges, linkedSource, sourceApps, sourceLinkFor, type ActivityRecordLike } from '../src/nimiday/domain/sources.js';
import { dayActions } from '../src/nimiday/store/actions.js';
import { createTestDayStore as createDayStore } from './persistence-fixture.js';
import { CollectionPersistenceError, chunkRecords, type JsonDocumentStore } from '../src/nimiday/store/json-documents.js';
import { readCollection, writeCollection } from './persistence-fixture.js';

function memoryStore(options: { failWrites?: () => boolean } = {}): JsonDocumentStore & { data: Map<string, unknown> } {
  const data = new Map<string, unknown>();
  return {
    data,
    read: async (path) => (data.has(path) ? structuredClone(data.get(path)) : undefined),
    write: async (path, value) => {
      if (options.failWrites?.()) throw Object.assign(new Error('operation temporarily unavailable'), { reasonCode: 'LOCAL_APP_OPERATION_UNAVAILABLE' });
      data.set(path, structuredClone(value));
    },
    remove: async (path) => { data.delete(path); },
  };
}

describe('persistence', () => {
  it('splits collections into bounded chunks and swaps generations', async () => {
    const store = memoryStore();
    const records = Array.from({ length: 500 }, (_, index) => ({ id: index, text: 'x'.repeat(1000) }));
    expect(chunkRecords(records).length).toBeGreaterThan(1);
    await writeCollection(store, 'items', records);
    const firstFiles = [...store.data.keys()].filter((key) => key.includes('items.g1-'));
    expect(firstFiles.length).toBeGreaterThan(1);
    await writeCollection(store, 'items', records.slice(0, 3));
    expect([...store.data.keys()].some((key) => key.includes('items.g1-'))).toBe(false);
    expect(await readCollection(store, 'items')).toEqual(records.slice(0, 3));
  });

  it('keeps the previous generation readable when a save is interrupted', async () => {
    let fail = false;
    const store = memoryStore({ failWrites: () => fail });
    await writeCollection(store, 'notes', [{ id: 'a' }]);
    fail = true;
    await expect(writeCollection(store, 'notes', [{ id: 'b' }])).rejects.toThrow('operation temporarily unavailable');
    expect(await readCollection(store, 'notes')).toEqual([{ id: 'a' }]);
  });

  it.each([null, [], {}, { generation: -1, chunks: 1 }, { generation: 1, chunks: 65 }, { generation: Number.MAX_SAFE_INTEGER + 1, chunks: 1 }])('rejects an invalid index instead of treating it as a missing collection: %j', async (index) => {
    const store = memoryStore();
    store.data.set('nimiday/v1/notes.index.json', index);
    store.data.set('nimiday/v1/notes.g1-0.json', [{ id: 'saved' }]);
    const before = structuredClone(store.data);
    await expect(readCollection(store, 'notes')).rejects.toThrow('index is damaged or unsupported');
    await expect(writeCollection(store, 'notes', [{ id: 'replacement' }])).rejects.toThrow('index is damaged or unsupported');
    expect(store.data).toEqual(before);
  });

  it('distinguishes an absent collection from an explicitly empty one', async () => {
    const store = memoryStore();
    expect(await readCollection(store, 'notes')).toBeUndefined();
    await writeCollection(store, 'notes', []);
    expect(await readCollection(store, 'notes')).toEqual([]);
  });

  it('accepts 64 chunks but refuses a 65th before writing any new document', async () => {
    const store = memoryStore();
    const records = Array.from({ length: 64 }, (_, id) => ({ id, text: 'x'.repeat(180 * 1024) }));
    await writeCollection(store, 'notes', records);
    expect(await readCollection(store, 'notes')).toEqual(records);
    const before = structuredClone(store.data);
    await expect(writeCollection(store, 'notes', [...records, { ...records[0], id: 64 }])).rejects.toThrow('collection is too large');
    expect(store.data).toEqual(before);
  });

  it('preflights every record before starting a new generation, counting UTF-8 bytes', async () => {
    const store = memoryStore();
    await writeCollection(store, 'notes', [{ id: 'saved' }]);
    const before = structuredClone(store.data);
    await expect(writeCollection(store, 'notes', [{ id: 'new' }, { text: '字'.repeat(90_000) }])).rejects.toThrow('record is too large');
    expect(store.data).toEqual(before);
    expect(chunkRecords([{ text: 'x'.repeat(200 * 1024) }])).toHaveLength(1);
  });

  it('refuses an exhausted generation without reusing a committed path', async () => {
    const store = memoryStore();
    store.data.set('nimiday/v1/notes.index.json', { version: 2, generation: Number.MAX_SAFE_INTEGER, current: [] });
    const before = structuredClone(store.data);
    await expect(writeCollection(store, 'notes', [{ id: 'new' }])).rejects.toThrow('generation cannot advance');
    expect(store.data).toEqual(before);
  });
});

describe('day store', () => {
  it('retries refused initial defaults explicitly instead of acknowledging an unsaved initial version', async () => {
    vi.useFakeTimers();
    const documents = memoryStore();
    let refused = true;
    const store = createDayStore({ ...documents, write: async (path, value) => {
      if (refused) throw Object.assign(new Error('quota'), { reasonCode: 'APP_STORAGE_QUOTA_EXCEEDED' });
      await documents.write(path, value);
    } }, { language: () => 'zh' });
    try {
      await store.load();
      await vi.advanceTimersByTimeAsync(400);
      expect(store.getSnapshot()).toMatchObject({ saving: 'error', unsaved: true, saveErrorKind: 'capacity' });
      expect((await store.persist()).ok).toBe(false);
      refused = false;
      expect(await store.persist()).toEqual({ ok: true });
      expect(documents.data.get('nimiday/v1/rhythms.json')).toHaveLength(3);
      expect(store.getSnapshot().unsaved).toBe(false);
    } finally {
      store.close();
      vi.useRealTimers();
    }
  });

  it.each([
    new CollectionPersistenceError('oversized collection', 'capacity'),
    Object.assign(new Error('quota'), { reasonCode: 'app-storage-quota-exceeded' }),
    Object.assign(new Error('quota'), { reasonCode: 'APP_STORAGE_QUOTA_EXCEEDED' }),
    new CollectionPersistenceError('damaged index', 'invalid-data'),
    Object.assign(new Error('native quota'), { reasonCode: 'resource-exhausted' }),
  ])('keeps refused edits unsaved without an endless retry, and permits an explicit recovery: %s', async (failure) => {
    vi.useFakeTimers();
    const documents = memoryStore();
    let refused = false;
    let attempts = 0;
    const store = createDayStore({ ...documents, write: async (path, value) => {
      attempts++;
      if (refused) throw failure;
      await documents.write(path, value);
    } }, { language: () => 'zh' });
    try {
      await store.load();
      await store.flush();
      refused = true;
      store.update((state) => ({ ...state, circles: [createCircle({ kind: 'self', name: '保存测试' }, new Date())] }), ['circles']);
      expect((await store.persist()).ok).toBe(false);
      const failedAttempts = attempts;
      await vi.advanceTimersByTimeAsync(90_000);
      expect(attempts).toBe(failedAttempts);
      expect(store.getSnapshot()).toMatchObject({ saving: 'error', unsaved: true });
      expect(store.getSnapshot().state.circles[0]?.name).toBe('保存测试');
      refused = false;
      expect(await store.persist()).toEqual({ ok: true });
      expect(store.getSnapshot()).toMatchObject({ saving: 'idle', unsaved: false, saveErrorKind: null });
    } finally {
      store.close();
      vi.useRealTimers();
    }
  });

  // @nimi-authority: rule.nimi.nimiday.assistant.skill-library
  it('persists explicit favorites without changing methods, lessons or routines', async () => {
    const documents = memoryStore();
    const store = createDayStore(documents, { language: () => 'zh' });
    await store.load();
    const actions = dayActions(store);
    expect(store.getSnapshot().state.favoriteSkillIds).toEqual([]);
    const rhythms = store.getSnapshot().state.rhythms;
    actions.adjustSkill('morning-care', { instructions: '先看逾期事项' });
    actions.addLesson('morning-care', '周一先看一周安排');
    actions.setSkillFavorite('morning-care', true);
    actions.setSkillFavorite('morning-care', true);
    actions.setSkillFavorite('not-a-skill', true);
    expect(store.getSnapshot().state.favoriteSkillIds).toEqual(['morning-care']);
    await store.flush();
    const reopened = createDayStore(documents, { language: () => 'zh' });
    await reopened.load();
    expect(reopened.getSnapshot().state.favoriteSkillIds).toEqual(['morning-care']);
    dayActions(reopened).setSkillFavorite('morning-care', false);
    expect(reopened.getSnapshot().state.favoriteSkillIds).toEqual([]);
    expect(reopened.getSnapshot().state.rhythms).toEqual(rhythms);
    expect(reopened.getSnapshot().state.skillOverrides[0]).toMatchObject({ instructions: '先看逾期事项', lessons: [{ text: '周一先看一周安排' }] });
    await reopened.flush();
    const again = createDayStore(documents, { language: () => 'zh' });
    await again.load();
    expect(again.getSnapshot().state.favoriteSkillIds).toEqual([]);
  });

  it('adds a new custom shortcut once, preserves explicit removal on edit, and cleans it on deletion', async () => {
    const store = createDayStore(memoryStore(), { language: () => 'zh' });
    await store.load();
    const actions = dayActions(store);
    const form = { icon: 'sparkles', name: '周末整理', purpose: '整理本周事项', request: '帮我整理', instructions: '先列出事项', tools: ['day_list_items'], materials: ['week'] as const, enabled: true };
    const created = actions.saveCustomSkill(form);
    expect(store.getSnapshot().state.favoriteSkillIds).toEqual([created.id]);
    actions.setSkillFavorite(created.id, false);
    actions.saveCustomSkill({ ...form, id: created.id, name: '每周整理' });
    expect(store.getSnapshot().state.favoriteSkillIds).toEqual([]);
    expect(store.getSnapshot().state.customSkills[0]?.name).toBe('每周整理');
    actions.setSkillFavorite(created.id, true);
    actions.deleteCustomSkill(created.id);
    expect(store.getSnapshot().state.favoriteSkillIds).toEqual([]);
    expect(store.getSnapshot().state.customSkills).toEqual([]);
  });

  it('starts fresh, saves changes and reloads them', async () => {
    const documents = memoryStore();
    const store = createDayStore(documents, { language: () => 'zh' });
    await store.load();
    expect(store.getSnapshot().status).toBe('ready');
    expect(store.getSnapshot().state.rhythms).toHaveLength(3);
    const now = new Date('2026-09-24T08:00:00+08:00');
    const circle = createCircle({ kind: 'elder', name: '妈妈' }, now);
    store.update((state) => ({
      ...state,
      circles: [circle],
      items: [createItem({ title: '陪妈妈复查', circleId: circle.id, date: '2026-09-28' }, { by: 'user' }, now)],
    }), ['circles', 'items']);
    await store.flush();
    const reopened = createDayStore(documents, { language: () => 'zh' });
    await reopened.load();
    expect(reopened.getSnapshot().state.circles.map((entry) => entry.name)).toEqual(['妈妈']);
    expect(reopened.getSnapshot().state.items.map((item) => item.title)).toEqual(['陪妈妈复查']);
  });

  it('never writes over saved data it could not read', async () => {
    const documents = memoryStore();
    documents.data.set('nimiday/v1/items.index.json', { version: 2, generation: 1, current: ['nimiday/v1/items.g1-0.json'] });
    const store = createDayStore(documents, { language: () => 'zh' });
    await store.load();
    expect(store.getSnapshot().status).toBe('failed');
    store.update((state) => ({ ...state, circles: [] }), ['circles']);
    await store.flush();
    expect(documents.data.has('nimiday/v1/circles.json')).toBe(false);
  });

  it('does not initialize or save over an unreadable collection index', async () => {
    const documents = memoryStore();
    documents.data.set('nimiday/v1/notes.index.json', { generation: 1, chunks: 67 });
    const before = structuredClone(documents.data);
    const store = createDayStore(documents, { language: () => 'zh' });
    await store.load();
    expect(store.getSnapshot().status).toBe('failed');
    expect(store.getSnapshot().loadError).toContain('index is damaged or unsupported');
    store.update((state) => ({ ...state, notes: [] }), ['notes']);
    await store.flush();
    expect(documents.data).toEqual(before);
    store.close();
  });

  it('keeps what the household learned when a custom skill is edited', async () => {
    const store = createDayStore(memoryStore(), { language: () => 'zh' });
    await store.load();
    const actions = dayActions(store);
    // Exactly the fields the skill editor saves.
    const form = { icon: 'sparkles', name: '给妈妈的每周电话', purpose: '每周整理要聊的事', request: '准备给妈妈打电话', instructions: '看看妈妈这周的事项。', tools: ['day_list_items'], materials: ['week'] as const, enabled: true };
    const created = actions.saveCustomSkill({ ...form, materials: [...form.materials] });
    actions.addLesson(created.id, '先问她睡得怎么样');
    expect(store.getSnapshot().state.customSkills[0]!.lessons.map((lesson) => lesson.text)).toEqual(['先问她睡得怎么样']);

    actions.saveCustomSkill({ ...form, materials: [...form.materials], id: created.id, name: '每周给妈妈打电话' });
    const edited = store.getSnapshot().state.customSkills[0]!;
    expect(edited.name).toBe('每周给妈妈打电话');
    expect(edited.lessons.map((lesson) => lesson.text)).toEqual(['先问她睡得怎么样']);

    // Removing a lesson is its own action.
    actions.removeLesson(created.id, edited.lessons[0]!.id);
    expect(store.getSnapshot().state.customSkills[0]!.lessons).toEqual([]);
  });

  it('marks runs that were executing before a restart as interrupted', async () => {
    const documents = memoryStore();
    await writeCollection(documents, 'runs', [{ id: 'run_1', skillId: 'morning-care', state: 'running', createdAt: new Date().toISOString() }]);
    const store = createDayStore(documents, { language: () => 'zh' });
    await store.load();
    expect(store.getSnapshot().state.runs[0]?.state).toBe('interrupted');
  });
});

describe('sources', () => {
  const record = (overrides: Partial<ActivityRecordLike>): ActivityRecordLike => ({
    activityId: 'act_1',
    source: { kind: 'app', appId: 'nimi.parentos', sourceRef: 'src_parentos_1', displayName: 'ParentOS', available: true },
    key: 'growth-record:c1:PO-REM-GRO-001:2',
    data: { childId: 'c1', childName: '小米', ruleId: 'PO-REM-GRO-001', repeatIndex: 2, windowStart: '2026-09-20', windowEnd: '2026-10-20' },
    revision: 1,
    kind: 'todo',
    todoState: 'open',
    attention: true,
    title: '身高体重头围记录（0-12月）',
    summary: '第 3 次 · 2026-09-20 至 2026-10-20',
    objectRef: 'reminder:c1:PO-REM-GRO-001:2',
    type: 'nimi.parentos.growth-record-reminder.v1',
    occurredAt: '2026-09-20T00:00:00.000Z',
    agent: null,
    userView: { unread: true, needsAttention: true },
    ...overrides,
  });

  it('never merges two sources\' records, and links an arrangement to its own source', () => {
    const now = new Date('2026-09-24T08:00:00+08:00');
    const circles = [createCircle({ kind: 'child', name: '小米' }, now)];
    const same = { objectRef: 'reminder:c1:checkup', type: 'nimi.parentos.care-reminder.v1', occurredAt: '2026-09-20T00:00:00.000Z', title: '18 月龄体检' };
    // Two registrations of the same App (an old one and a new one) publish the same object reference.
    const done = record({ ...same, activityId: 'act_old', source: { kind: 'app', appId: 'nimi.parentos', displayName: 'ParentOS', available: true, sourceRef: 'src_old' }, todoState: 'completed', revision: 8 });
    const open = record({ ...same, activityId: 'act_new', source: { kind: 'app', appId: 'nimi.parentos', displayName: 'ParentOS', available: true, sourceRef: 'src_new' }, todoState: 'open', revision: 1 });
    const changes = followedChanges([done, open], { ...DEFAULT_PROFILE }, circles);
    expect(changes.map((change) => [change.id, change.todoState]).sort()).toEqual([['act_new', 'open'], ['act_old', 'completed']]);

    // An arrangement made for the new source's reminder follows that reminder, not the old source's.
    const fromNew = sourceLinkFor(changes.find((change) => change.id === 'act_new')!);
    expect(linkedSource(fromNew, changes)?.id).toBe('act_new');
    expect(linkedSource(fromNew, changes)?.todoState).toBe('open');
    // With its record gone, it is not re-attached to the other source by guess.
    expect(linkedSource(fromNew, changes.filter((change) => change.id !== 'act_new'))).toBeNull();
  });

  it('labels known sources and maps them to the right person', () => {
    const now = new Date('2026-09-24T08:00:00+08:00');
    const child = createCircle({ kind: 'child', name: '小米' }, now);
    const self = createCircle({ kind: 'self', name: '我自己' }, now);
    const changes = followedChanges([
      record({}),
      record({
        activityId: 'act_2',
        source: { kind: 'app', appId: 'nimi.shijing', displayName: '时镜 ShiJing', available: true },
        kind: 'activity',
        todoState: null,
        objectRef: null,
        type: 'nimi.shijing.rijing-reading.v1',
        title: '9月24日的日镜已生成',
        occurredAt: '2026-09-24T00:05:00.000Z',
      }),
      record({ activityId: 'act_3', source: { kind: 'runtime-agent', appId: null, displayName: 'Aya', available: true } }),
      record({ activityId: 'act_4', source: { kind: 'app', appId: 'nimi.day', displayName: 'NimiDay', available: true } }),
      record({ activityId: 'act_5', source: { kind: 'app', appId: 'nimi.realm-world-studio', displayName: 'RWS', available: true }, type: 'nimi.realm-world-studio.coauthor-candidate.v1' }),
    ], DEFAULT_PROFILE, [child, self]);
    expect(changes.map((change) => change.id)).toEqual(['act_2', 'act_1']);
    expect(changes[0]).toMatchObject({ nature: 'interpretation', circleId: self.id, openable: false, known: 'shijing-daily-mirror' });
    expect(changes[1]).toMatchObject({ nature: 'reminder', circleId: null, openable: true, known: 'parentos-growth-record' });
  });

  it('files ParentOS care reminders under the child as something to arrange', () => {
    const now = new Date('2026-09-24T08:00:00+08:00');
    const child = createCircle({ kind: 'child', name: '小米' }, now);
    const [change] = followedChanges([
      record({
        activityId: 'act_care',
        type: 'nimi.parentos.care-reminder.v1',
        title: '流感疫苗接种',
        summary: '建议近期到社区医院接种',
        objectRef: 'reminder:c1:PO-REM-VAC-012:1',
        key: 'care-reminder:c1:PO-REM-VAC-012:1',
        data: { childId: 'c1', childName: '小米', ruleId: 'PO-REM-VAC-012', repeatIndex: 1, windowStart: '2026-09-20', windowEnd: '2026-10-20' },
      }),
    ], { ...DEFAULT_PROFILE, sourceGroups: [{ key: 'src_parentos_1\u0000child:c1', appId: 'nimi.parentos', circleId: child.id }] }, [child]);
    expect(change).toMatchObject({ nature: 'reminder', circleId: child.id, openable: true, known: 'parentos-care-reminder' });
  });

  it('respects the user following an extra app and hiding records', () => {
    const profile = {
      ...DEFAULT_PROFILE,
      sources: [{ appId: 'nimi.realm-world-studio', enabled: true, circleId: null }, { appId: 'nimi.parentos', enabled: false, circleId: null }],
      hiddenSourceIds: ['act_9'],
    };
    const changes = followedChanges([
      record({}),
      record({ activityId: 'act_5', source: { kind: 'app', appId: 'nimi.realm-world-studio', displayName: 'RWS', available: true }, type: 'x.y.v1' }),
      record({ activityId: 'act_9', source: { kind: 'app', appId: 'nimi.realm-world-studio', displayName: 'RWS', available: true }, type: 'x.y.v1' }),
    ], profile, []);
    expect(changes.map((change) => change.id)).toEqual(['act_5']);
    expect(sourceApps([record({}), record({ activityId: 'act_5', source: { kind: 'app', appId: 'nimi.realm-world-studio', displayName: 'RWS', available: true } })]).map((app) => app.appId).sort())
      .toEqual(['nimi.parentos', 'nimi.realm-world-studio']);
  });
});
