import assert from 'node:assert/strict';
import test from 'node:test';
import { cleanupBehaviorModules, importBehaviorModule } from './helpers.mjs';

test.after(cleanupBehaviorModules);

const model = () => importBehaviorModule('lab/activity/lab-activity-model.js');

function record(overrides = {}) {
  return {
    activityId: `act_${'0'.repeat(26)}`,
    source: { kind: 'app', sourceRef: 'src_x', appId: 'nimi.realm-world-studio', displayName: 'Realm World Studio', available: true },
    key: 'coauthor:draft', revision: 1, kind: 'todo', todoState: 'open', attention: true,
    title: 'Review coauthor proposal', summary: null, objectRef: 'draft:01ABC',
    type: 'nimi.realm-world-studio.coauthor-candidate.v1',
    data: { worldName: 'Tidewater', task: 'develop', suggestions: 5, notes: 2 },
    agent: null, occurredAt: '2026-09-23T01:00:00.000Z', publishedAt: '2026-09-23T01:00:00.000Z',
    updatedAt: '2026-09-23T01:00:00.000Z', changeSeq: '1',
    userView: { readThroughRevision: 0, unread: true, needsAttention: true },
    ...overrides,
  };
}

test('Lab reads one business field set from the Realm World Studio extension', async () => {
  const { labActivityBusinessDetail } = await model();
  assert.deepEqual(labActivityBusinessDetail(record()), {
    kind: 'world-coauthor', worldName: 'Tidewater', task: 'develop', suggestions: 5, notes: 2, adopted: null,
  });
  assert.equal(labActivityBusinessDetail(record({ data: { worldName: 'Tidewater', task: 'develop', suggestions: 5, notes: 2, adopted: 3 } })).adopted, 3);
});

test('unknown, foreign or malformed extension data falls back to the generic card', async () => {
  const { labActivityBusinessDetail } = await model();
  assert.equal(labActivityBusinessDetail(record({ type: 'org.unknown.thing.v2' })), null);
  assert.equal(labActivityBusinessDetail(record({ source: { kind: 'app', sourceRef: 'src_y', appId: 'com.other.app', displayName: 'Other', available: true } })), null);
  assert.equal(labActivityBusinessDetail(record({ data: { worldName: 'Tidewater', task: 'publish', suggestions: 1, notes: 0 } })), null);
  assert.equal(labActivityBusinessDetail(record({ data: { worldName: 'Tidewater', task: 'review', suggestions: -1, notes: 0 } })), null);
  assert.equal(labActivityBusinessDetail(record({ data: null })), null);
});

test('the open to-do scope asks Runtime only for open todos', async () => {
  const { labActivityFilter } = await model();
  assert.deepEqual(labActivityFilter('open-todos'), { kind: 'todo', todoStates: ['open'] });
  assert.deepEqual(labActivityFilter('all'), {});
});
