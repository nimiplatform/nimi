import assert from 'node:assert/strict';
import test from 'node:test';
import type { NimiRuntimeLocalEnvironmentDependencyJob, NimiRuntimeLocalTransferSessionSummary } from '@nimiplatform/sdk/runtime';
import { AppPackageJobPhase, type AppPackageJob } from '@nimiplatform/sdk/runtime/wire-types';
import { createDownloadHistoryStore, downloadHistoryRecord } from '../src/shell/renderer/features/runtime-config/download-history-store.js';
import { projectDownloadLane } from '../src/shell/renderer/features/runtime-config/download-history-projection.js';
import type { RuntimeSetupTask } from '../src/shell/renderer/features/runtime-config/runtime-setup-task-store.js';

function memoryStorage() {
  const values = new Map<string, string>();
  return { values, getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
}
const transfer = (id: string, state = 'completed', updatedAt = '2026-10-26T10:00:00Z') => ({
  installSessionId: id, state, updatedAt, planId: `plan-${id}`,
}) as NimiRuntimeLocalTransferSessionSummary;
const environment = (id: string, state = 'ready_managed') => ({ jobId: id, state, updatedAt: '2026-10-26T10:00:00Z' }) as NimiRuntimeLocalEnvironmentDependencyJob;
const app = (id: number, phase = AppPackageJobPhase.COMPLETED) => ({
  jobId: new Uint8Array([id]), appId: 'app-a', phase, updatedAt: { seconds: String(id), nanos: 0 },
}) as AppPackageJob;
const setup = (id: string, transferIds: string[], dependencyJobIds: string[] = []) => ({
  taskId: id, status: 'done', updatedAt: '2026-10-26T10:00:00Z', createdAt: '2026-10-26T09:00:00Z',
  refs: { transferIds, dependencyJobIds, installPlanIds: [] }, draft: { profileUseId: 'profile-use-a' },
}) as unknown as RuntimeSetupTask;
function fixture() {
  return {
    lane: 'history' as const,
    tasks: [setup('setup-a', ['a'], ['a']), setup('setup-b', ['b'])],
    transfers: [transfer('a'), transfer('b'), transfer('standalone'), transfer('running', 'running'), transfer('failed', 'failed')],
    environments: [environment('a'), environment('standalone'), environment('failed', 'failed')],
    appJobs: [app(1), app(2), app(3, AppPackageJobPhase.FAILED), app(4, AppPackageJobPhase.DOWNLOADING)],
    removed: {},
  };
}

test('removing one complete setup group persists all associated steps without touching owner input', () => {
  const input = fixture();
  const original = structuredClone(input);
  const storage = memoryStorage();
  const store = createDownloadHistoryStore('root-a', storage);
  const initial = projectDownloadLane(input);
  assert.equal(initial.count, 4, 'count user-visible groups, not internal steps');
  assert.equal(initial.setupGroups.length, 1);
  assert.equal(initial.setupGroups[0]!.tasks.length, 2);
  store.remove(initial.setupGroups[0]!.records);
  const restored = createDownloadHistoryStore('root-a', storage);
  const next = projectDownloadLane({ ...input, removed: restored.getSnapshot().entries });
  assert.equal(next.count, 3);
  assert.equal(next.setupGroups.length, 0);
  assert.deepEqual(next.transferGroups.map(group => group.latest.installSessionId), ['standalone']);
  assert.deepEqual(next.environments.map(job => job.jobId), ['standalone']);
  assert.deepEqual(input, original, 'history preferences never mutate execution records');
  assert.equal(projectDownloadLane({ ...input, removed: createDownloadHistoryStore('root-b', storage).getSnapshot().entries }).count, 4);
});

test('bulk clear affects only the captured history snapshot, including every grouped App attempt', () => {
  const input = fixture();
  const storage = memoryStorage();
  const store = createDownloadHistoryStore('root-a', storage);
  store.remove(projectDownloadLane(input).records);
  const removed = store.getSnapshot().entries;
  assert.equal(projectDownloadLane({ ...input, removed }).count, 0);
  assert.equal(projectDownloadLane({ ...input, lane: 'active', removed }).count, 2);
  assert.equal(projectDownloadLane({ ...input, lane: 'attention', removed }).count, 3);
  assert.equal(projectDownloadLane({ ...input, transfers: [...input.transfers, transfer('new')], appJobs: [...input.appJobs, app(5)], removed }).count, 2);
});

test('a resumed task and a later completed revision reappear despite an older removal', () => {
  const storage = memoryStorage();
  const store = createDownloadHistoryStore('root-a', storage);
  const input = { lane: 'history' as const, tasks: [], transfers: [transfer('a', 'cancelled')], environments: [], appJobs: [], removed: {} };
  store.remove(projectDownloadLane(input).records);
  const removed = store.getSnapshot().entries;
  assert.equal(projectDownloadLane({ ...input, removed }).count, 0);
  assert.equal(projectDownloadLane({ ...input, lane: 'active', transfers: [transfer('a', 'running')], removed }).count, 1);
  assert.equal(projectDownloadLane({ ...input, transfers: [transfer('a', 'completed', '2026-10-26T11:00:00Z')], removed }).count, 1);
});

test('failed persistent writes do not publish successful removal; malformed preferences are surfaced', () => {
  let published = 0;
  const store = createDownloadHistoryStore('root-a', { getItem: () => null, setItem: () => { throw Error('quota exceeded'); } });
  store.subscribe(() => { published += 1; });
  const before = store.getSnapshot();
  assert.throws(() => store.remove([downloadHistoryRecord('model', 'a', 'completed', 'now')]), /quota/);
  assert.equal(store.getSnapshot(), before);
  assert.equal(published, 0);
  const invalid = createDownloadHistoryStore('root-a', { getItem: () => '{broken', setItem: () => assert.fail('must not overwrite unreadable preferences') });
  assert.equal(invalid.getSnapshot().readFailed, true);
  assert.throws(() => invalid.remove([]));
});

test('concurrent preference writers preserve each other’s removed records', () => {
  const storage = memoryStorage();
  const first = createDownloadHistoryStore('root-a', storage);
  const second = createDownloadHistoryStore('root-a', storage);
  first.remove([downloadHistoryRecord('model', 'a', 'completed', 'now')]);
  second.remove([downloadHistoryRecord('environment', 'a', 'ready', 'now')]);
  assert.equal(Object.keys(createDownloadHistoryStore('root-a', storage).getSnapshot().entries).length, 2);
});
