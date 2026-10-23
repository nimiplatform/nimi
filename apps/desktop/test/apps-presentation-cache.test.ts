import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AppsPresentationCache, type AppsPresentationStorage } from '../src/shell/renderer/features/apps/apps-presentation-cache.js';
import { createAppsPanelProjectionReloader } from '../src/shell/renderer/features/apps/apps-panel-controller.js';
import { appPresentationKey, mergeAppPresentation, retainCurrentAppPresentation, type DesktopAppsEntry, type DesktopAppsPanelProjection } from '../src/shell/renderer/features/apps/apps-panel-projection.js';
import type { LocalDevelopmentRegistration } from '../src/shell/renderer/features/local-development/local-development-types.js';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(finish => { resolve = finish; });
  return { promise, resolve };
}
function storage(): AppsPresentationStorage {
  const rows = new Map<string, Awaited<ReturnType<AppsPresentationStorage['read']>>>();
  return { read: async key => rows.get(key), write: async row => { rows.set(row.key, structuredClone(row)); } };
}
const flush = () => new Promise(resolve => setTimeout(resolve, 0));

test('presentation survives a new cache instance, coalesces readers and stays account-scoped', async () => {
  const disk = storage();
  let reads = 0;
  const load = async () => { reads++; return 'image'; };
  const first = new AppsPresentationCache({ scope: 'account-a', storage: disk });
  assert.deepEqual(await Promise.all([first.get('release-1', load, { maxAgeMs: Infinity }), first.get('release-1', load, { maxAgeMs: Infinity })]), ['image', 'image']);
  assert.equal(reads, 1);
  const restarted = new AppsPresentationCache({ scope: 'account-a', storage: disk });
  assert.equal(await restarted.get('release-1', load, { maxAgeMs: Infinity }), 'image');
  assert.equal(reads, 1, 'restart must not reread an immutable installed release');
  await restarted.get('release-2', load, { maxAgeMs: Infinity });
  await new AppsPresentationCache({ scope: 'account-b', storage: disk }).get('release-1', load, { maxAgeMs: Infinity });
  assert.equal(reads, 3, 'a new release and a different account cannot reuse the old row');
});

test('expired and missing artwork revalidates; failures keep cached artwork and back off', async () => {
  let now = 100;
  const cache = new AppsPresentationCache({ now: () => now });
  await cache.get('icon', async () => 'old', { maxAgeMs: 10 });
  now = 120;
  const refresh = deferred<string>();
  const shown: string[] = [];
  const update = cache.get('icon', () => refresh.promise, { maxAgeMs: 10, onCached: value => shown.push(value) });
  assert.deepEqual(shown, ['old']);
  refresh.resolve('new');
  assert.equal(await update, 'new');
  now = 150;
  let failures = 0;
  const fail = async (): Promise<string> => { failures++; throw new Error('read failed'); };
  await assert.rejects(cache.get('icon', fail, { maxAgeMs: 10, onCached: value => shown.push(value) }), /read failed/);
  await assert.rejects(cache.get('icon', fail, { maxAgeMs: 10 }), /read failed/);
  assert.equal(failures, 1);
  assert.equal(shown.at(-1), 'new');
  cache.retryFailures();
  assert.equal(await cache.get('icon', async () => 'recovered', { maxAgeMs: 10 }), 'recovered');
  assert.equal(await cache.get('absent', async () => null, { maxAgeMs: 10 }), null);
  now += 11;
  assert.equal(await cache.get('absent', async () => 'added later', { maxAgeMs: 10 }), 'added later');
});

test('four stuck reads time out and release slots for the next App; broken storage is optional', async () => {
  const brokenDisk: AppsPresentationStorage = { read: async () => { throw Error('disk'); }, write: async () => { throw Error('disk'); } };
  const cache = new AppsPresentationCache({ storage: brokenDisk, timeoutMs: 15 });
  const stuck = Array.from({ length: 4 }, (_, index) => cache.get(`stuck-${index}`, () => new Promise<never>(() => {}), { maxAgeMs: 10 }).catch(error => error.message));
  assert.equal(await cache.get('healthy', async () => 'ready', { maxAgeMs: 10 }), 'ready');
  assert.deepEqual(await Promise.all(stuck), Array(4).fill('App information read timed out'));
});

function registration(id: string, generation = 1): LocalDevelopmentRegistration {
  return { selector: `dev-project-${id}`, appId: id, displayName: id, canonicalProjectRoot: `/${id}`, shell: 'electron',
    appAccess: [], aiConfigAllowedRoutes: ['local'], capabilityContractRefs: [], sourceGeneration: generation, declarationGeneration: 1, registeredAtUnixMs: 1, updatedAtUnixMs: 1 };
}

test('a blocked README cannot hide its icon, a slow App cannot hold lifecycle or Catalog refresh', async () => {
  const readme = deferred<{ content: string }>();
  const slowIcon = deferred<string>();
  const ready = deferred<void>();
  let current: DesktopAppsPanelProjection | null = null;
  const loaded = () => {
    const snapshot = current as DesktopAppsPanelProjection | null;
    if (snapshot?.status !== 'loaded') throw new Error('Expected loaded inventory');
    return snapshot;
  };
  let state = 'running';
  const reloader = createAppsPanelProjectionReloader({
    source: {
      listCommittedReleases: async () => [], listPackageJobs: async () => [],
      listRegistrations: async () => [registration('fast'), registration('slow')],
      listRuns: async () => [{ ...registration('fast'), state, message: '', retryable: false, hostGeneration: 1 }],
      listApprovedCatalogTargets: async () => [],
      readAppIcon: selector => selector.endsWith('slow') ? slowIcon.promise : Promise.resolve('real-icon'),
      readProjectReadme: () => readme.promise,
    },
    getCurrent: () => current,
    commit: next => { current = next; if (next.status === 'loaded' && next.entries[0]?.iconUrl === 'real-icon') ready.resolve(); },
  });
  await reloader.reload(false);
  assert.equal(current!.status, 'loaded');
  await ready.promise;
  assert.equal(loaded().entries[0]?.summary, null);
  state = 'stopped';
  await reloader.reload(false);
  await reloader.refreshCatalog();
  const result = loaded();
  assert.equal(result.entries[0]?.run?.state, 'stopped');
  assert.equal(result.entries[0]?.iconUrl, 'real-icon');
  assert.equal(result.catalogStatus, 'loaded');
  reloader.dispose();
  const before = current;
  slowIcon.resolve('late'); readme.resolve({ content: 'late description' });
  await flush(); await flush();
  assert.equal(current, before, 'a departed view must not commit late content');
});

test('late presentation cannot resurrect removed rows or replace a different source generation', () => {
  const entry: DesktopAppsEntry = { identity: { entryKey: 'dev:one', appId: 'one', displayName: 'One', sourceClass: 'local_development', updatedAtUnixMs: 1 },
    localDevelopment: registration('one'), catalogTarget: null, committedRelease: null, packageJob: null, run: null, iconUrl: null, summary: null, aiConfigSummary: null };
  const projection = (entries: DesktopAppsEntry[]): DesktopAppsPanelProjection => ({ status: 'loaded', entries, catalogStatus: 'loaded', runtimeError: null });
  const removed = projection([]);
  assert.equal(mergeAppPresentation(removed, entry, { iconUrl: 'late' }), removed);
  const newer = projection([{ ...entry, localDevelopment: registration('one', 2) }]);
  assert.equal(mergeAppPresentation(newer, entry, { iconUrl: 'late' }), newer);
  assert.equal(appPresentationKey({ ...entry, localDevelopment: { ...registration('one'), selector: 'new-session-selector' } }), appPresentationKey(entry), 'host selectors must not invalidate presentation across restart');
  const current = mergeAppPresentation(projection([entry]), entry, { iconUrl: 'ready' });
  const staleInventory = retainCurrentAppPresentation(current, projection([entry]));
  assert.equal(staleInventory.status === 'loaded' && staleInventory.entries[0]?.iconUrl, 'ready');
});
