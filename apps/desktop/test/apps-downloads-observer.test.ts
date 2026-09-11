import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AppPackageJobKind, AppPackageJobPhase, AppPackageSourceClass, ReasonCode, type AppPackageJob } from '@nimiplatform/sdk/runtime/wire-types';
import { createAppsJobsObserver, mergePackageJobs, type AppsJobsSnapshot } from '../src/shell/renderer/features/apps/apps-downloads-observer.js';

function job(id: number, phase = AppPackageJobPhase.QUEUED, time = 1): AppPackageJob {
  return {
    jobId: new Uint8Array([id]), appId: `example.${id}`, kind: AppPackageJobKind.INSTALL, sourceClass: AppPackageSourceClass.VERIFIED,
    targetRef: `target-${id}`, phase, progressBasis: 1, bytesCompleted: '100', bytesTotal: '200', stepsCompleted: '0',
    terminalResult: 0, reasonCode: '', cancelable: true, queuePosition: id, speedBytesPerSec: '20', etaSeconds: '5',
    displayName: `App ${id}`, targetVersion: '1.0.0', previousVersion: '', targetOs: 'macos', targetArch: 'aarch64',
    updatedAt: { seconds: String(time), nanos: 0 }, startedAt: { seconds: '1', nanos: 0 },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
type Client = Parameters<typeof createAppsJobsObserver>[0];
const listed = (jobs: AppPackageJob[]) => ({ reasonCode: ReasonCode.ACTION_EXECUTED, jobs });

test('full job projection retains history and newer owner observations, with immutable terminals', () => {
  const complete = job(1, AppPackageJobPhase.COMPLETED, 5);
  const paused = job(2, AppPackageJobPhase.PAUSED, 4);
  const merged = mergePackageJobs([complete, paused], [job(1, AppPackageJobPhase.DOWNLOADING, 8), job(2, AppPackageJobPhase.DOWNLOADING, 3), job(3)]);
  assert.equal(merged.length, 3);
  assert.equal(merged[0], complete);
  assert.equal(merged[1], paused);
  assert.deepEqual(mergePackageJobs(merged, []), [], 'an empty complete owner List is not replaced by local history');
});

test('a pre-control List arriving after cancellation cannot restore downloading', async () => {
  const oldRead = deferred<ReturnType<typeof listed>>();
  const snapshots: AppsJobsSnapshot[] = [];
  let calls = 0;
  const canceled = job(1, AppPackageJobPhase.CANCELED, 5);
  const client = {
    listAppPackageJobs: async () => ++calls === 1 ? listed([job(1, AppPackageJobPhase.DOWNLOADING)]) : calls === 2 ? oldRead.promise : listed([canceled]),
    cancelAppPackageJob: async () => ({ reasonCode: ReasonCode.ACTION_EXECUTED, job: canceled }),
  } as unknown as Client;
  const observer = createAppsJobsObserver(client, (snapshot) => snapshots.push(snapshot), async () => 'root-a');
  await observer.refresh();
  const reading = observer.refresh();
  await new Promise((resolve) => setImmediate(resolve));
  const canceling = observer.control('cancel', observer.getSnapshot().jobs);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(observer.getSnapshot().jobs[0]?.phase, AppPackageJobPhase.CANCELED);
  oldRead.resolve(listed([job(1, AppPackageJobPhase.DOWNLOADING, 2)]));
  await reading;
  assert.deepEqual(await canceling, [{ jobId: '01', error: null }]);
  const canceledIndex = snapshots.findIndex((snapshot) => snapshot.jobs[0]?.phase === AppPackageJobPhase.CANCELED);
  assert.ok(canceledIndex >= 0);
  assert.ok(snapshots.slice(canceledIndex).every((snapshot) => snapshot.jobs[0]?.phase === AppPackageJobPhase.CANCELED));
  assert.equal(calls, 3, 'control completion performs a fresh owner read');
});

test('batch control freezes membership and preserves individual failures before re-reading truth', async () => {
  const first = deferred<{ reasonCode: ReasonCode; job: AppPackageJob }>();
  const pauseIds: number[] = [];
  let reads = 0;
  const client = {
    listAppPackageJobs: async () => ++reads === 1 ? listed([job(1), job(2)]) : listed([job(1, AppPackageJobPhase.PAUSED, 2), job(2), job(3)]),
    pauseAppPackageJob: async ({ jobId }: { jobId: Uint8Array }) => {
      pauseIds.push(jobId[0]!);
      if (jobId[0] === 1) return first.promise;
      throw new Error('phase changed');
    },
  } as unknown as Client;
  const observer = createAppsJobsObserver(client, () => undefined, async () => 'root-a');
  await observer.refresh();
  const selected = [...observer.getSnapshot().jobs];
  const pending = observer.control('pause', selected);
  selected.push(job(3));
  first.resolve({ reasonCode: ReasonCode.ACTION_EXECUTED, job: job(1, AppPackageJobPhase.PAUSED, 2) });
  const results = await pending;
  assert.deepEqual(pauseIds, [1, 2]);
  assert.deepEqual(results.map((result) => result.error), [null, 'phase changed']);
  assert.equal(observer.getSnapshot().jobs[2]?.phase, AppPackageJobPhase.QUEUED);
  assert.deepEqual(observer.getSnapshot().pendingIds, []);
});

test('an unavailable owner keeps last confirmed jobs and disables commands', async () => {
  let offline = false;
  let commands = 0;
  const client = {
    listAppPackageJobs: async () => { if (offline) throw new Error('disconnected'); return listed([job(1)]); },
    pauseAppPackageJob: async () => { commands++; throw new Error('unexpected command'); },
  } as unknown as Client;
  const observer = createAppsJobsObserver(client, () => undefined, async () => 'root-a');
  await observer.refresh();
  offline = true;
  await observer.refresh();
  assert.equal(observer.getSnapshot().status, 'unavailable');
  assert.equal(observer.getSnapshot().jobs.length, 1);
  assert.deepEqual(await observer.control('pause', observer.getSnapshot().jobs), []);
  assert.equal(commands, 0);
});

test('changing root activation resets terminal stickiness for copied job IDs', async () => {
  let activation = 'root-a';
  const client = { listAppPackageJobs: async () => listed([job(1, activation === 'root-a' ? AppPackageJobPhase.COMPLETED : AppPackageJobPhase.PAUSED, 5)]) } as unknown as Client;
  const observer = createAppsJobsObserver(client, () => undefined, async () => activation);
  await observer.refresh();
  assert.equal(observer.getSnapshot().jobs[0]?.phase, AppPackageJobPhase.COMPLETED);
  activation = 'root-b';
  await observer.refresh();
  assert.equal(observer.getSnapshot().jobs[0]?.phase, AppPackageJobPhase.PAUSED);
});

test('root activation change during a batch discards the old response and stops further commands', async () => {
  let activation = 'root-a';
  const commands: number[] = [];
  const client = {
    listAppPackageJobs: async () => listed([job(1), job(2)]),
    pauseAppPackageJob: async ({ jobId }: { jobId: Uint8Array }) => {
      commands.push(jobId[0]!);
      activation = 'root-b';
      return { reasonCode: ReasonCode.ACTION_EXECUTED, job: job(jobId[0]!, AppPackageJobPhase.PAUSED, 4) };
    },
  } as unknown as Client;
  const observer = createAppsJobsObserver(client, () => undefined, async () => activation);
  await observer.refresh();
  const results = await observer.control('pause', observer.getSnapshot().jobs);
  assert.deepEqual(commands, [1]);
  assert.equal(results.length, 2);
  assert.ok(results.every((result) => result.error?.includes('data root changed')));
  assert.ok(observer.getSnapshot().jobs.every((row) => row.phase === AppPackageJobPhase.QUEUED));
});
