import assert from 'node:assert/strict';
import { it } from 'node:test';
import { createAppsPanelProjectionReloader } from '../src/shell/renderer/features/apps/apps-panel-controller.js';
import type { DesktopAppAIConfigReadOptions, DesktopAppsPanelProjection, DesktopAppsProjectionSource } from '../src/shell/renderer/features/apps/apps-panel-projection.js';
import type { LocalDevelopmentRegistration } from '../src/shell/renderer/features/local-development/local-development-types.js';
import type { NimiAIConfigSnapshot } from '@nimiplatform/kit/core/sdk-contract';

const snapshot: NimiAIConfigSnapshot = { config: null, revision: '0', effectiveSelections: [] };
const registration = (index: number): LocalDevelopmentRegistration => ({
  selector: `dev-${index}`, appId: `app.${index}`, displayName: `App ${index}`, canonicalProjectRoot: `/app-${index}`,
  shell: 'electron', appAccess: ['runtime.consume'], aiConfigAllowedRoutes: ['local'], capabilityContractRefs: [],
  sourceGeneration: 1, declarationGeneration: 1, registeredAtUnixMs: index, updatedAtUnixMs: index,
});
const flush = () => new Promise<void>(resolve => setTimeout(resolve, 0));
async function until(predicate: () => boolean): Promise<void> {
  for (let index = 0; index < 30 && !predicate(); index++) await flush();
  assert.ok(predicate(), 'expected projection lifecycle state');
}
function fixture() {
  const reads: { appId: string; options: DesktopAppAIConfigReadOptions }[] = [];
  let releaseAll = false;
  const pending: (() => void)[] = [];
  let active = 0, peak = 0, version = 1, current: DesktopAppsPanelProjection | null = null, commits = 0;
  const source: DesktopAppsProjectionSource = {
    listCommittedReleases: async () => [], listPackageJobs: async () => [], listRuns: async () => [],
    listRegistrations: async () => Array.from({ length: 7 }, (_, index) => ({ ...registration(index), displayName: `App ${index} v${version}` })),
    readAppIcon: async () => 'data:image/png;base64,ready',
    readAppAIConfig: async (appId, options) => {
      reads.push({ appId, options }); active++; peak = Math.max(peak, active);
      if (!releaseAll) await new Promise<void>(resolve => pending.push(resolve));
      active--;
      return snapshot;
    },
  };
  const reloader = createAppsPanelProjectionReloader({ source, getCurrent: () => current, commit: value => { current = value; commits++; } });
  return { source, reads, reloader,
    get current() { return current; }, get commits() { return commits; }, get peak() { return peak; },
    updateLifecycle() { version++; },
    release() { releaseAll = true; pending.splice(0).forEach(resolve => resolve()); },
  };
}

it('keeps the AI reload lane single-flight until all eligible configuration reads finish while lifecycle and icons stay visible', async () => {
  const view = fixture();
  const first = view.reloader.reload(true);
  try {
    await until(() => view.reads.length === 4 && view.current?.status === 'loaded' && Boolean(view.current.entries[0]?.iconUrl));
    assert.equal(view.reloader.reload(true), first, 'inventory completion must not release the AI lane');
    assert.equal(view.current?.status === 'loaded' && view.current.entries.length, 7);
    view.updateLifecycle();
    await view.reloader.reload(false);
    assert.equal(view.current?.status === 'loaded' && view.current.entries[0]?.identity.displayName, 'App 6 v2');
    assert.equal(view.reads.length, 4, 'lifecycle refresh does not enqueue configuration reads');
    view.release();
    await first;
    assert.equal(view.reads.length, 7, 'the entire workspace configuration projection is still queried');
    assert.equal(new Set(view.reads.map(read => read.appId)).size, 7);
    assert.equal(view.peak, 4);
    await view.reloader.reload(true);
    assert.equal(view.reads.length, 14, 'a completed lane permits the next explicit refresh without a TTL');
  } finally { view.reloader.dispose(); view.release(); await first; }
});

it('dispose aborts active SDK read signals and stops queued configuration work even if a reader resolves late', async () => {
  const view = fixture();
  const first = view.reloader.reload(true);
  try {
    await until(() => view.reads.length === 4);
    const before = view.commits;
    view.reloader.dispose();
    assert.ok(view.reads.every(read => read.options.signal.aborted), 'all current reads must receive cancellation');
    await first;
    await flush();
    assert.equal(view.reads.length, 4, 'the remaining three reads must never start');
    assert.equal(view.commits, before);
    view.release();
    await flush();
    assert.equal(view.commits, before, 'late responses do not change the departed view');
    await view.reloader.reload(true);
    assert.equal(view.reads.length, 4);
  } finally { view.reloader.dispose(); view.release(); await first; }
});

it('dispose during inventory loading prevents the delayed enrichment task from starting', async () => {
  const view = fixture();
  let finish!: (value: LocalDevelopmentRegistration[]) => void;
  view.source.listRegistrations = () => new Promise(resolve => { finish = resolve; });
  const first = view.reloader.reload(true);
  view.reloader.dispose();
  finish([registration(0)]);
  await first;
  await flush();
  try {
    assert.equal(view.reads.length, 0);
    assert.equal(view.commits, 0);
  } finally { view.release(); }
});

it('an explicit refresh supersedes old reads so late failures cannot overwrite newly read configuration', async () => {
  const view = fixture();
  const old: { signal: AbortSignal; reject: (error: Error) => void }[] = [];
  let freshReads = 0;
  view.source.readAppAIConfig = async (_appId, options) => new Promise((_resolve, reject) => old.push({ signal: options.signal, reject }));
  const first = view.reloader.reload(true);
  try {
    await until(() => old.length === 4);
    view.source.readAppAIConfig = async () => { freshReads++; return snapshot; };
    const fresh = view.reloader.reload(true, true);
    assert.notEqual(fresh, first);
    assert.ok(old.every(read => read.signal.aborted));
    await fresh;
    assert.equal(freshReads, 7, 'a saved configuration or explicit retry triggers a complete fresh read');
    const before = view.commits;
    old.forEach(read => read.reject(new Error('Late old configuration read failure')));
    await first;
    await flush();
    assert.equal(view.commits, before);
    assert.ok(view.current?.status === 'loaded' && view.current.entries.every(entry => entry.aiConfigSummary?.healthPosture === 'healthy'));
  } finally {
    view.reloader.dispose();
    old.forEach(read => read.reject(new Error('Test cleanup')));
    await first;
  }
});

it('unfinished presentation content does not keep a completed AI lane occupied', async () => {
  const view = fixture();
  const pendingReadmes: ((value: { content: string }) => void)[] = [];
  let released = false;
  view.source.readProjectReadme = () => released ? Promise.resolve({ content: 'Late description' }) : new Promise(resolve => { pendingReadmes.push(resolve); });
  view.release();
  try {
    const first = view.reloader.reload(true);
    await first;
    const second = view.reloader.reload(true);
    assert.notEqual(second, first);
    await second;
    assert.equal(view.reads.length, 14);
    assert.ok(view.current?.status === 'loaded' && view.current.entries.some(entry => entry.iconUrl));
  } finally { view.reloader.dispose(); released = true; pendingReadmes.forEach(resolve => resolve({ content: 'Late description' })); }
});
