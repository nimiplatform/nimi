import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { NimiAppActivityRecord, NimiAppActivityViewSnapshot } from '@nimiplatform/sdk/app';
import { mergeActivitySnapshots } from '../src/shell/renderer/features/home/home-app-activity-model.js';
import {
  activityMessage,
  filterCenterMessages,
  groupMessages,
  homePreviewGroups,
  isPendingMessage,
  messageDomainOfGroup,
  realmPostMessage,
  systemMessage,
  type HomeRealmPost,
  type HomeSystemMessage,
} from '../src/shell/renderer/features/home/home-messages-model.js';
import {
  DEFAULT_HOME_MESSAGE_PREFERENCES,
  HOME_MESSAGE_PREFERENCES_PATH,
  applyHomeMessagePreferenceChange,
  isHiddenFromHome,
  isSourceOffHome,
  parseHomeMessagePreferences,
  readHomeMessagePreferences,
  writeHomeMessagePreferences,
} from '../src/shell/renderer/features/home/home-messages-preferences.js';

function record(n: number, overrides: Partial<NimiAppActivityRecord> = {}): NimiAppActivityRecord {
  return {
    activityId: `act_${String(n).padStart(26, '0')}`,
    source: { kind: 'app', sourceRef: 'src_studio', appId: 'com.example.studio', displayName: 'Studio', available: true },
    key: `draft-${n}`,
    revision: 1,
    kind: 'todo',
    todoState: 'open',
    attention: true,
    title: `Review draft ${n}`,
    summary: `Chapter ${n} is ready for review`,
    objectRef: `draft:${n}`,
    type: 'com.example.studio.draft-review.v1',
    data: null,
    agent: null,
    occurredAt: new Date(Date.UTC(2026, 8, 23, 2, n)).toISOString(),
    publishedAt: new Date(Date.UTC(2026, 8, 23, 2, n)).toISOString(),
    updatedAt: new Date(Date.UTC(2026, 8, 23, 2, n)).toISOString(),
    changeSeq: String(n),
    userView: { readThroughRevision: 0, unread: true, needsAttention: true },
    ...overrides,
  };
}

function snapshot(records: NimiAppActivityRecord[]): NimiAppActivityViewSnapshot {
  return { status: 'ready', records, complete: true, hasMore: false, error: null };
}

function post(id: string, overrides: Partial<HomeRealmPost> = {}): HomeRealmPost {
  return {
    id,
    authorKind: 'personaCharacter',
    authorRef: 'persona_lumi',
    authorName: 'Lumi',
    authorAvatarUrl: null,
    caption: `Post ${id}`,
    createdAt: '2026-09-22T12:00:00.000Z',
    media: [],
    ...overrides,
  };
}

function system(kind: HomeSystemMessage['kind'], id: string, time: string | null): HomeSystemMessage {
  return { kind, id, title: `${kind} ${id}`, detail: '', progress: null, time, app: null, open: () => undefined };
}

const RUNTIME_SOURCE = { kind: 'runtime-agent', sourceRef: 'src_runtime', appId: null, displayName: null, available: true } as const;

test('the two App views join at the highest decimal change sequence before state is judged', () => {
  // 2^53 and 2^53 + 1 are equal as Numbers; only the decimal comparison orders them.
  const open = record(1, { changeSeq: '9007199254740992' });
  const completed = record(1, { changeSeq: '9007199254740993', revision: 2, todoState: 'completed' });
  const readOpen = record(2, { userView: { readThroughRevision: 1, unread: false, needsAttention: false } });
  const merged = mergeActivitySnapshots(snapshot([open, readOpen]), snapshot([completed]));
  assert.equal(merged.length, 2, 'one card per activityId');
  const joined = merged.find((item) => item.activityId === open.activityId)!;
  assert.equal(joined.changeSeq, '9007199254740993');
  assert.equal(joined.todoState, 'completed');
  assert.equal(isPendingMessage(activityMessage(joined)), false);
  assert.equal(isPendingMessage(activityMessage(readOpen)), true, 'a read open todo stays pending');
});

test('App sources group by sourceRef, Runtime summaries by agentRef, Realm Posts by trusted author', () => {
  const studioA = activityMessage(record(3));
  const studioB = activityMessage(record(4, {
    source: { kind: 'app', sourceRef: 'src_studio_second', appId: 'com.example.studio', displayName: 'Studio', available: false },
  }));
  const unknownType = activityMessage(record(5, {
    source: { kind: 'app', sourceRef: 'src_vendor', appId: null, displayName: null, available: true },
    type: 'org.unknown.vendor.thing.v7',
  }));
  const turn = activityMessage(record(6, {
    source: RUNTIME_SOURCE, kind: 'activity', todoState: null, objectRef: null,
    agent: { agentRef: 'agr_nova', displayName: 'Nova' },
  }));
  const loose = activityMessage(record(7, { source: RUNTIME_SOURCE, kind: 'activity', todoState: null, objectRef: null }));
  const trusted = [realmPostMessage(post('p1')), realmPostMessage(post('p2'))];
  const untrusted = [
    realmPostMessage(post('p3', { authorRef: null, authorName: 'Nova' })),
    realmPostMessage(post('p4', { authorRef: null, authorName: 'Nova' })),
  ];
  const groups = groupMessages([studioA, studioB, unknownType, turn, loose, ...trusted, ...untrusted]);
  const keys = groups.map((group) => group.key).sort();
  assert.deepEqual(keys, [
    'app:src_studio',
    'app:src_studio_second',
    'app:src_vendor',
    'realm-author:personaCharacter:persona_lumi',
    'realm-post:p3',
    'realm-post:p4',
    'runtime-agent',
    'runtime-agent:agr_nova',
  ]);
  assert.equal(groups.find((group) => group.key === 'realm-author:personaCharacter:persona_lumi')!.messages.length, 2);
  assert.notEqual(turn.groupKey, trusted[0]!.groupKey, 'a Runtime summary never joins a Realm author group');
});

test('work in progress leads, then owner time newest first, then items without a time', () => {
  const download = systemMessage({ ...system('download', 'install-1', '2026-09-20T00:00:00.000Z'), progress: { value: 1, max: 4 } });
  const update = systemMessage(system('update', 'com.example.studio', null));
  const setup = systemMessage(system('setup', 'task-1', '2026-09-22T00:00:00.000Z'));
  const newest = activityMessage(record(9, { occurredAt: '2026-09-23T09:00:00.000Z' }));
  const older = activityMessage(record(8, { occurredAt: '2026-09-21T09:00:00.000Z' }));
  const order = filterCenterMessages([update, older, setup, newest, download], 'all', null).map((message) => message.key);
  assert.deepEqual(order, [download.key, newest.key, setup.key, older.key, update.key]);
});

test('the Home preview keeps every system category and at most five source groups', () => {
  const sources = Array.from({ length: 7 }, (_, index) => activityMessage(record(20 + index, {
    source: { kind: 'app', sourceRef: `src_${index}`, appId: `com.example.app${index}`, displayName: `App ${index}`, available: true },
  })));
  const systems = [
    systemMessage(system('download', 'install-1', null)),
    systemMessage(system('setup', 'task-1', null)),
    systemMessage(system('update', 'com.example.app0', null)),
    systemMessage(system('update', 'com.example.app1', null)),
  ];
  const groups = homePreviewGroups([...sources, ...systems]);
  assert.equal(groups.filter((group) => group.sourceKind === 'system').length, 3, 'one card or stack per system category');
  assert.equal(groups.filter((group) => group.sourceKind !== 'system').length, 5);
  assert.equal(groups.find((group) => group.key === 'system:update')!.messages.length, 2, 'each update keeps its own App target');
});

test('Pending holds open todos and system items only', () => {
  const openRead = activityMessage(record(30, { userView: { readThroughRevision: 1, unread: false, needsAttention: false } }));
  const completed = activityMessage(record(31, { todoState: 'completed' }));
  const summary = activityMessage(record(32, { kind: 'activity', todoState: null, objectRef: null }));
  const turn = activityMessage(record(33, { source: RUNTIME_SOURCE, kind: 'activity', todoState: null, objectRef: null }));
  const realm = realmPostMessage(post('p5'));
  const setup = systemMessage(system('setup', 'task-2', null));
  const pending = filterCenterMessages([openRead, completed, summary, turn, realm, setup], 'pending', null);
  assert.deepEqual(pending.map((message) => message.key), [openRead.key, setup.key]);
  assert.deepEqual(filterCenterMessages([openRead, completed, realm], 'all', 'app:src_studio').map((message) => message.key).sort(), [completed.key, openRead.key].sort());
  assert.equal(messageDomainOfGroup(null), null);
  assert.equal(messageDomainOfGroup('app:src_studio'), 'app');
  assert.equal(messageDomainOfGroup('runtime-agent:agr_nova'), 'runtime-agent');
  assert.equal(messageDomainOfGroup('realm-post:p5'), 'realm-post');
  assert.equal(messageDomainOfGroup('realm-author:personaCharacter:persona_lumi'), 'realm-post');
  assert.equal(messageDomainOfGroup('system:setup'), 'system');
});

test('Home hiding keeps the displayed revision; a read change stays hidden and a new revision returns', () => {
  const shown = activityMessage(record(40, { revision: 3 }));
  const hidden = applyHomeMessagePreferenceChange(DEFAULT_HOME_MESSAGE_PREFERENCES, {
    kind: 'hide',
    activities: [{ activityId: shown.record.activityId, revision: 3 }],
    realmPostIds: ['p6'],
  });
  const markedRead = activityMessage(record(40, {
    revision: 3,
    changeSeq: '41',
    userView: { readThroughRevision: 3, unread: false, needsAttention: false },
  }));
  assert.equal(isHiddenFromHome(markedRead, hidden), true, 'the same revision stays hidden after mark read');
  assert.equal(isHiddenFromHome(activityMessage(record(40, { revision: 4 })), hidden), false, 'a higher revision shows again');
  assert.equal(isHiddenFromHome(realmPostMessage(post('p6')), hidden), true);
  assert.equal(isHiddenFromHome(systemMessage(system('setup', 'task-3', null)), hidden), false, 'system items cannot be hidden');
  // Hiding an older revision never lowers the hidden revision.
  const again = applyHomeMessagePreferenceChange(hidden, { kind: 'hide', activities: [{ activityId: shown.record.activityId, revision: 2 }], realmPostIds: [] });
  assert.equal(again.hiddenActivities[shown.record.activityId], 3);
  const restored = applyHomeMessagePreferenceChange(hidden, { kind: 'show', activityId: shown.record.activityId });
  assert.equal(isHiddenFromHome(shown, restored), false);
  assert.equal(isHiddenFromHome(realmPostMessage(post('p6')), restored), true, 'restoring one card leaves the others hidden');
});

test('source display choices and restore-all stay independent', () => {
  const studio = activityMessage(record(50));
  const turn = activityMessage(record(51, { source: RUNTIME_SOURCE, kind: 'activity', todoState: null, objectRef: null }));
  const realm = realmPostMessage(post('p7'));
  let preferences = applyHomeMessagePreferenceChange(DEFAULT_HOME_MESSAGE_PREFERENCES, { kind: 'app-source', sourceRef: 'src_studio', onHome: false });
  preferences = applyHomeMessagePreferenceChange(preferences, { kind: 'realm-posts', onHome: false });
  preferences = applyHomeMessagePreferenceChange(preferences, { kind: 'hide', activities: [{ activityId: studio.record.activityId, revision: 1 }], realmPostIds: [] });
  assert.equal(isSourceOffHome(studio, preferences), true);
  assert.equal(isSourceOffHome(realm, preferences), true);
  assert.equal(isSourceOffHome(turn, preferences), false, 'Runtime summaries have no source switch');
  const cleared = applyHomeMessagePreferenceChange(preferences, { kind: 'restore-hidden' });
  assert.deepEqual(cleared.hiddenActivities, {});
  assert.deepEqual(cleared.appSourcesOffHome, ['src_studio'], 'restore-all keeps source choices');
  assert.equal(cleared.realmPostsOnHome, false);
  const back = applyHomeMessagePreferenceChange(cleared, { kind: 'app-source', sourceRef: 'src_studio', onHome: true });
  assert.deepEqual(back.appSourcesOffHome, []);
});

test('only an explicit missing document reads as no preferences; the document round-trips', async () => {
  const missing = { reasonCode: 'APP_STORAGE_ENTRY_NOT_FOUND' };
  const reads: string[] = [];
  const empty = await readHomeMessagePreferences({
    readJson: async (path) => { reads.push(path); throw missing; },
    writeJson: async () => { throw new Error('unused'); },
  });
  assert.deepEqual(reads, [HOME_MESSAGE_PREFERENCES_PATH]);
  assert.deepEqual(empty, DEFAULT_HOME_MESSAGE_PREFERENCES);
  await assert.rejects(readHomeMessagePreferences({
    readJson: async () => { throw { reasonCode: 'LOCAL_APP_OWNER_UNAVAILABLE' }; },
    writeJson: async () => { throw new Error('unused'); },
  }), (error: unknown) => (error as { reasonCode?: string }).reasonCode === 'LOCAL_APP_OWNER_UNAVAILABLE');
  const written: unknown[] = [];
  const preferences = applyHomeMessagePreferenceChange(DEFAULT_HOME_MESSAGE_PREFERENCES, {
    kind: 'hide', activities: [{ activityId: 'act_1', revision: 2 }], realmPostIds: ['p8'],
  });
  await writeHomeMessagePreferences({
    readJson: async () => { throw new Error('unused'); },
    writeJson: async (path, value) => { written.push(value); return { value, sizeBytes: 1 }; },
  }, preferences);
  assert.deepEqual(parseHomeMessagePreferences(written[0]), preferences);
  assert.throws(() => parseHomeMessagePreferences({ version: 1, hiddenActivities: { act_1: 0 }, hiddenRealmPosts: [], appSourcesOffHome: [], realmPostsOnHome: true }));
  assert.throws(() => parseHomeMessagePreferences({ version: 2 }));
});
