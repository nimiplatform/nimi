import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { JSDOM } from 'jsdom';
import { QueryClient, QueryClientProvider, notifyManager } from '@tanstack/react-query';
import type { DesktopCanonicalRendererBindings } from '../src/shell/renderer/renderer/contract.js';
import { DesktopRendererBindingProvider } from '../src/shell/renderer/renderer/binding-context.js';
import { GlobalDownloadsProvider } from '../src/shell/renderer/features/runtime-config/global-downloads-context.js';
import { CAPABILITY_INVENTORY_KEY, useCapabilityInventory, type CapabilityInventory } from '../src/shell/renderer/features/runtime-config/runtime-capability-inventory.js';
import { getRuntimeSetupTaskStore } from '../src/shell/renderer/features/runtime-config/runtime-setup-task-store.js';
import { RUNTIME_MODEL_LIBRARY_KEY } from '../src/shell/renderer/features/runtime-config/use-runtime-model-library.js';
import { LOADOUT_ENVIRONMENT_KEY } from '../src/shell/renderer/features/runtime-config/runtime-local-model-status.js';
import { createDesktopQueryClient } from '../src/shell/renderer/infra/query-client/query-client.js';

type InventoryLog = { area: string; message: string; flowId: string; costMs?: number; details: Record<string, unknown> };

// Real React Query and consumer/provider lifetimes, with scripted SDK reads.
// This verifies request ownership, not Runtime readiness or product acceptance.
test('capability inventory owns each query once across consumer lifetimes', async t => {
  const dom = new JSDOM('<!doctype html><body></body>', { url: 'http://localhost', pretendToBeVisual: true });
  const logs: InventoryLog[] = [];
  const globals = { window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    __NIMI_RENDERER_ENV__: { VITE_NIMI_VERBOSE_RENDERER_LOGS: '1' },
    __NIMI_ELECTRON_TEST__: { async invoke(command: string, payload: unknown) {
      assert.equal(command, 'log_renderer_event');
      logs.push((payload as { payload: InventoryLog }).payload);
      return null;
    } },
    React, IS_REACT_ACT_ENVIRONMENT: true };
  const previous = new Map(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  const { createRoot } = await import('react-dom/client');
  const cached: CapabilityInventory = { aggregate: { loadouts: [], selections: [
    { capabilityContract: 'text.generate', loadoutId: 'text', effectiveDefaults: {} },
    { capabilityContract: 'image.generate', loadoutId: 'image', effectiveDefaults: {} },
  ], selectionRevisions: {} }, recipes: [], environments: {} };
  const flush = async () => act(async () => { await new Promise<void>(resolve => setTimeout(resolve, 5)); });
  const until = async (predicate: () => boolean, attempts = 40) => {
    for (let i = 0; i < attempts && !predicate(); i++) await flush();
    assert.ok(predicate(), 'expected inventory query state');
  };
  const mount = async (options: { productionRetry?: boolean; failBaseAttempts?: number; failProfile?: boolean } = {}) => {
    const client = options.productionRetry ? createDesktopQueryClient()
      : new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
    if (options.productionRetry) client.setDefaultOptions({ queries: { ...client.getDefaultOptions().queries, gcTime: Infinity } });
    const logOffset = logs.length;
    const reads = { get: [] as (AbortSignal | undefined)[], recipes: [] as (AbortSignal | undefined)[], profiles: [] as (AbortSignal | undefined)[],
      plans: [] as { capability: string; signal: AbortSignal | undefined; profileModel: string | undefined }[] };
    let gate: Promise<void> = Promise.resolve();
    let planGate: Promise<void> = Promise.resolve();
    let profileGate: Promise<void> = Promise.resolve();
    const bindings = {
      sdk: {
        machineProduct: () => ({ local: { loadouts: {
          get: async (callOptions?: { signal?: AbortSignal }) => {
            reads.get.push(callOptions?.signal); await gate;
            if (reads.get.length <= (options.failBaseAttempts ?? 0)) throw new Error('do-not-log secret-fixture /fixture/model.gguf');
            return cached.aggregate;
          },
          listRecipes: async (_capability?: string, options?: { signal?: AbortSignal }) => { reads.recipes.push(options?.signal); return []; },
        } } }),
        localEnvironmentRpc: () => ({
          listLocalTransfers: async () => ({ transfers: [] }), listLocalEnvironmentDependencyJobs: async () => ({ jobs: [] }),
          collectDeviceProfile: async (_request: unknown, callOptions?: { signal?: AbortSignal }) => {
            reads.profiles.push(callOptions?.signal);
            const sample = reads.profiles.length;
            await profileGate;
            if (options.failProfile) throw Error('device observation failed');
            return { profile: { os: 'windows', arch: 'amd64', totalRamBytes: '0', availableRamBytes: '0', diskFreeBytes: '0', ports: [],
              gpu: { available: true, vendor: 'test', model: `sample-${sample}`, totalVramBytes: '0', availableVramBytes: '0', memoryModel: 0 },
              python: { available: false, version: '' }, npu: { available: false, ready: false, vendor: '', runtime: '', detail: '' } } };
          },
          resolveLocalEnvironmentPlan: async (request: { capabilityContract: string; hostProfile?: { gpu?: { model: string } } }, options?: { signal?: AbortSignal }) => {
            reads.plans.push({ capability: request.capabilityContract, signal: options?.signal, profileModel: request.hostProfile?.gpu?.model });
            await planGate;
            throw new Error('Scripted unavailable environment');
          },
        }),
      },
      app: { commands: { firstRun: { getRecord: async () => ({ record: { dataRoot: { rootActivationId: 'inventory-query-test' } } }) } } },
    } as unknown as DesktopCanonicalRendererBindings;
    let latest!: ReturnType<typeof useCapabilityInventory>;
    function Consumer({ enabled }: { enabled: boolean }) { latest = useCapabilityInventory({ enabled }); return null; }
    const container = document.createElement('div'); document.body.appendChild(container);
    const root = createRoot(container);
    const show = async (consumers: number | readonly boolean[]) => act(async () => root.render(
      <QueryClientProvider client={client}><DesktopRendererBindingProvider bindings={bindings}>
        <GlobalDownloadsProvider>{(typeof consumers === 'number' ? Array.from({ length: consumers }, () => true) : consumers)
          .map((enabled, index) => <Consumer key={index} enabled={enabled} />)}</GlobalDownloadsProvider>
      </DesktopRendererBindingProvider></QueryClientProvider>,
    ));
    return { client, reads, show, get latest() { return latest; },
      get logs() { return logs.slice(logOffset).filter(log => log.area === 'runtime-capability-inventory'); },
      hold() { let release!: () => void; gate = new Promise(resolve => { release = resolve; }); return release; },
      holdPlans() { let release!: () => void; planGate = new Promise(resolve => { release = resolve; }); return release; },
      holdProfile() { let release!: () => void; profileGate = new Promise(resolve => { release = resolve; }); return release; },
      async close() {
        await act(async () => {
          root.unmount();
          await client.cancelQueries();
          client.clear();
          // Cancellation can finish before its queued observer notification.
          // Drain the same scheduler while the real DOM is still available.
          await new Promise<void>(resolve => notifyManager.schedule(resolve));
        });
        container.remove();
      },
    };
  };
  try {
    await t.test('each query shares one newly collected profile across all its plans', async () => {
      const view = await mount();
      try {
        await view.show(2); await until(() => !view.latest.isFetching);
        assert.equal(view.reads.profiles.length, 1);
        assert.deepEqual(view.reads.plans.map(plan => plan.profileModel), ['sample-1', 'sample-1']);
        assert.ok(view.reads.plans.every(plan => plan.signal === view.reads.profiles[0]));
        await act(async () => { await view.latest.refetch(); });
        await until(() => !view.latest.isFetching);
        assert.equal(view.reads.profiles.length, 2, 'a later read must not reuse historical device facts');
        assert.deepEqual(view.reads.plans.slice(2).map(plan => plan.profileModel), ['sample-2', 'sample-2']);
      } finally { await view.close(); }
    });

    await t.test('unavailable device facts retain base inventory without an automatic full retry', async () => {
      const view = await mount({ productionRetry: true, failProfile: true });
      try {
        await view.show(1); await until(() => !view.latest.isFetching);
        assert.equal(view.reads.profiles.length, 1);
        assert.equal(view.reads.get.length, 1);
        assert.equal(view.reads.plans.length, 0, 'do not fabricate a zero snapshot or repeat the failed probe per plan');
        assert.deepEqual(view.latest.data?.aggregate, cached.aggregate);
        assert.deepEqual(view.latest.data?.environments, { 'text.generate': undefined, 'image.generate': undefined });
      } finally { await view.close(); }
    });

    await t.test('leaving during device observation cancels the read before any plans start', async () => {
      const view = await mount();
      const release = view.holdProfile();
      try {
        await view.show(1); await until(() => view.reads.profiles.length === 1);
        await view.show([false]); await flush();
        assert.equal(view.reads.profiles[0]?.aborted, true);
        await act(async () => release()); await flush();
        assert.equal(view.reads.plans.length, 0);
        assert.equal(view.latest.data, undefined);
      } finally { release(); await view.close(); }
    });

    await t.test('cold multiple consumers and a same-commit visibility handoff execute one logged attempt', async () => {
      const view = await mount();
      const release = view.hold();
      try {
        await view.show([true, true, false]); await flush();
        assert.equal(view.reads.get.length, 1);
        await view.show([false, false, true]); await flush();
        assert.equal(view.reads.get.length, 1);
        assert.equal(view.reads.get[0]?.aborted, false);
        const starts = view.logs.filter(log => log.message.endsWith(':start'));
        assert.equal(starts.length, 1);
        assert.equal(starts[0]!.details.hasData, false);
        assert.equal(starts[0]!.details.dataAgeMs, null);
        assert.equal(starts[0]!.details.fetchFailureCount, 0);
        assert.equal(starts[0]!.details.active, true);
        await act(async () => release()); await until(() => !view.latest.isFetching);
        const attempt = view.logs.filter(log => log.flowId === starts[0]!.flowId);
        assert.deepEqual(attempt.map(log => log.message.split(':').at(-1)), ['start', 'base-ready', 'settled']);
        assert.equal(attempt.at(-1)!.details.outcome, 'success');
        assert.equal(attempt.at(-1)!.details.plansStarted, 2);
        assert.equal(attempt.at(-1)!.details.plansFulfilled, 0);
        assert.equal(attempt.at(-1)!.details.plansRejected, 2);
        assert.ok(attempt.every(log => typeof log.costMs === 'number' && log.costMs >= 0 && typeof log.details.atUnixMs === 'number'));
      } finally { release(); await view.close(); }
    });

    await t.test('a genuine cold visibility gap logs base abort immediately and a separate resumed attempt', async () => {
      const view = await mount();
      const release = view.hold();
      let releaseResumed = () => {};
      try {
        await view.show([true]); await flush();
        const firstFlow = view.logs.find(log => log.message.endsWith(':start'))!.flowId;
        await view.show([false]); await flush();
        const aborted = view.logs.find(log => log.flowId === firstFlow && log.message.endsWith(':abort'));
        assert.equal(aborted?.details.stage, 'base');
        assert.equal(aborted?.details.active, false);
        assert.equal(aborted?.details.plansStarted, 0);
        assert.equal(view.logs.some(log => log.flowId === firstFlow && log.message.endsWith(':settled')), false, 'abort logging does not wait for a non-cooperative reader');
        releaseResumed = view.hold();
        await view.show([true]); await flush();
        assert.equal(view.reads.get.length, 2);
        await act(async () => release()); await flush();
        assert.equal(view.reads.plans.length, 0);
        assert.equal(view.logs.find(log => log.flowId === firstFlow && log.message.endsWith(':settled'))?.details.outcome, 'aborted');
        await act(async () => releaseResumed()); await until(() => !view.latest.isFetching);
        const starts = view.logs.filter(log => log.message.endsWith(':start'));
        assert.equal(starts.length, 2);
        assert.notEqual(starts[0]!.flowId, starts[1]!.flowId);
        assert.deepEqual(starts.map(log => log.details.fetchFailureCount), [0, 0], 'navigation replacement is not a retry');
        assert.equal(view.reads.plans.length, 2);
      } finally { release(); releaseResumed(); await view.close(); }
    });

    await t.test('plan-stage cancellation has one immediate abort and one eventual aborted settlement', async () => {
      const view = await mount();
      const release = view.holdPlans();
      view.client.setQueryData(CAPABILITY_INVENTORY_KEY, cached, { updatedAt: Date.now() - 30_000 });
      try {
        await view.show(1); await until(() => view.reads.plans.length === 2);
        const flow = view.logs.find(log => log.message.endsWith(':start'))!.flowId;
        await view.show([false]); await flush();
        const aborts = view.logs.filter(log => log.flowId === flow && log.message.endsWith(':abort'));
        assert.equal(aborts.length, 1);
        assert.equal(aborts[0]!.details.stage, 'plans');
        assert.equal(aborts[0]!.details.plansStarted, 2);
        assert.equal(aborts[0]!.details.plansRejected, null, 'unfinished aggregate results are not presented as a count');
        await act(async () => release()); await flush();
        const settlements = view.logs.filter(log => log.flowId === flow && log.message.endsWith(':settled'));
        assert.equal(settlements.length, 1);
        assert.equal(settlements[0]!.details.outcome, 'aborted');
        assert.equal(view.client.getQueryData(CAPABILITY_INVENTORY_KEY), cached);
      } finally { release(); await view.close(); }
    });

    await t.test('the production single retry logs a failed base attempt then failureCount one, while plan failures do not retry', async () => {
      const view = await mount({ productionRetry: true, failBaseAttempts: 1 });
      try {
        await view.show(2);
        await until(() => view.reads.get.length === 2 && !view.latest.isFetching, 400);
        assert.equal(view.reads.recipes.length, 2);
        assert.equal(view.reads.plans.length, 2);
        assert.equal(view.reads.get[0], view.reads.get[1], 'retry uses the same underlying fetch cancellation signal');
        const starts = view.logs.filter(log => log.message.endsWith(':start'));
        assert.deepEqual(starts.map(log => log.details.fetchFailureCount), [0, 1]);
        const settlements = view.logs.filter(log => log.message.endsWith(':settled'));
        assert.deepEqual(settlements.map(log => [log.details.stage, log.details.outcome]), [['base', 'failed'], ['plans', 'success']]);
        assert.equal(view.logs.filter(log => log.message.endsWith(':base-ready')).length, 1);
        assert.doesNotMatch(JSON.stringify(view.logs), /secret-fixture|model\.gguf|text\.generate|image\.generate/u);
      } finally { await view.close(); }
    });

    await t.test('a stale cached consumer mount starts one query, and fresh remounts do not invalidate it', async () => {
      const view = await mount();
      const release = view.hold();
      view.client.setQueryData(CAPABILITY_INVENTORY_KEY, cached, { updatedAt: Date.now() - 30_000 });
      try {
        await view.show(1); await flush();
        assert.equal(view.reads.get.length, 1, 'mount must not cancel and restart the stale-cache fetch');
        assert.equal(view.reads.recipes.length, 1);
        await act(async () => release());
        await until(() => !view.latest.isFetching);
        await view.show(0); await view.show(1); await flush();
        assert.equal(view.reads.get.length, 1, 'fresh cache remains fresh when another screen consumes it');
      } finally { release(); await view.close(); }
    });

    await t.test('multiple stale-cache consumers share one query and preserve explicit refresh', async () => {
      const view = await mount();
      const release = view.hold();
      view.client.setQueryData(CAPABILITY_INVENTORY_KEY, cached, { updatedAt: Date.now() - 30_000 });
      try {
        await view.show(3); await flush();
        assert.equal(view.reads.get.length, 1);
        assert.equal(view.reads.recipes.length, 1);
        await act(async () => release());
        await until(() => !view.latest.isFetching);
        assert.deepEqual(view.reads.plans.map(read => read.capability), ['text.generate', 'image.generate']);
        const signal = view.reads.get[0];
        assert.ok(signal instanceof AbortSignal);
        assert.equal(view.reads.recipes[0], signal);
        assert.ok(view.reads.plans.every(read => read.signal === signal));
        assert.deepEqual(Object.keys(view.latest.data!.environments), ['text.generate', 'image.generate'], 'non-cancellation plan failures remain explicit unavailable entries');
        await act(async () => { const result = await view.latest.refetch({ cancelRefetch: false }); assert.equal(result.status, 'success'); });
        assert.equal(view.logs.filter(log => log.message.endsWith(':explicit-refetch')).length, 1);
        assert.equal(view.reads.get.length, 2);
        assert.equal(view.reads.recipes.length, 2);
        assert.equal(view.reads.plans.length, 4);
        await view.show(0);
        view.client.setQueryData(CAPABILITY_INVENTORY_KEY, cached, { updatedAt: Date.now() - 30_000 });
        await view.show(3);
        await until(() => !view.latest.isFetching);
        assert.equal(view.reads.get.length, 3, 'a stale remount still performs one fresh query');
      } finally { release(); await view.close(); }
    });

    await t.test('the persistent owner skips initial revision and invalidates all three keys once on actual task changes', async () => {
      const store = getRuntimeSetupTaskStore();
      const task = store.createTask({ taskId: 'inventory-query-task', capabilityContract: 'text.generate', source: { kind: 'runtime', accountId: 'test-account' } });
      const view = await mount();
      const keys = [CAPABILITY_INVENTORY_KEY, RUNTIME_MODEL_LIBRARY_KEY, LOADOUT_ENVIRONMENT_KEY];
      const invalidations: string[] = [];
      const unsubscribe = view.client.getQueryCache().subscribe(event => {
        if (event.type === 'updated' && event.action.type === 'invalidate') invalidations.push(JSON.stringify(event.query.queryKey));
      });
      const seed = () => {
        view.client.setQueryData(CAPABILITY_INVENTORY_KEY, cached);
        view.client.setQueryData(RUNTIME_MODEL_LIBRARY_KEY, []);
        view.client.setQueryData(LOADOUT_ENVIRONMENT_KEY, {});
      };
      try {
        seed();
        await view.show(3); await flush();
        assert.equal(view.reads.get.length, 0, 'existing setup state does not invalidate a fresh cache on owner mount');
        assert.equal(invalidations.length, 0);
        await act(async () => { store.updateTask(task.taskId, () => ({ status: 'done' })); });
        await until(() => !view.latest.isFetching);
        assert.equal(view.reads.get.length, 1);
        assert.deepEqual(invalidations.sort(), keys.map(key => JSON.stringify(key)).sort());
        assert.equal(view.logs.filter(log => log.message.endsWith(':invalidate') && log.details.cause === 'setup-revision').length, 1);
        assert.doesNotMatch(JSON.stringify(view.logs), /inventory-query-task|test-account/u);
        invalidations.length = 0; seed();
        await act(async () => { store.updateTask(task.taskId, () => ({ candidateRevisionBaseline: 'next-selection' })); });
        await until(() => !view.latest.isFetching);
        assert.equal(view.reads.get.length, 2, 'selection baseline changes still refresh the query');
        assert.deepEqual(invalidations.sort(), keys.map(key => JSON.stringify(key)).sort());
        invalidations.length = 0;
        await act(async () => { store.updateTask(task.taskId, () => ({ nextAction: 'return-to-source' })); });
        await flush();
        assert.equal(view.reads.get.length, 2, 'unrelated presentation updates do not invent an invalidation');
        assert.equal(invalidations.length, 0);
      } finally { unsubscribe(); await view.close(); store.stopTask(task.taskId); store.dismissTask(task.taskId); }
    });

    await t.test('leaving the last consumer cancels base reads and never starts late environment plans', async () => {
      const view = await mount();
      const release = view.hold();
      view.client.setQueryData(CAPABILITY_INVENTORY_KEY, cached, { updatedAt: Date.now() - 30_000 });
      try {
        await view.show(1); await flush();
        await view.show(0);
        assert.equal(view.reads.get[0]?.aborted, true);
        assert.equal(view.reads.recipes[0], view.reads.get[0]);
        await act(async () => release());
        await flush(); await flush();
        assert.equal(view.reads.plans.length, 0, 'late base responses cannot fan out after query cancellation');
        assert.equal(view.client.getQueryData(CAPABILITY_INVENTORY_KEY), cached);
      } finally { release(); await view.close(); }
    });

    await t.test('cancelled environment reads reject the query function instead of returning a partial inventory', async () => {
      const view = await mount();
      const release = view.holdPlans();
      view.client.setQueryData(CAPABILITY_INVENTORY_KEY, cached);
      try {
        await view.show(1);
        const queryFn = view.client.getQueryCache().find({ queryKey: CAPABILITY_INVENTORY_KEY })?.options.queryFn;
        assert.equal(typeof queryFn, 'function');
        if (typeof queryFn !== 'function') throw Error('Expected registered inventory query function');
        const controller = new AbortController();
        const request = Promise.resolve(queryFn({ client: view.client, queryKey: CAPABILITY_INVENTORY_KEY, signal: controller.signal, meta: undefined }));
        const rejection = assert.rejects(request, error => error instanceof DOMException && error.name === 'AbortError');
        await until(() => view.reads.plans.length === 2);
        controller.abort();
        release();
        await rejection;
        assert.ok(view.reads.plans.every(read => read.signal === controller.signal && read.signal.aborted));
      } finally { release(); await view.close(); }
    });

    await t.test('a mounted hidden consumer stops its query and returns fresh after inactive invalidation', async () => {
      const view = await mount();
      const release = view.hold();
      view.client.setQueryData(CAPABILITY_INVENTORY_KEY, cached, { updatedAt: Date.now() - 30_000 });
      let releaseOther!: () => void;
      let otherSignal!: AbortSignal;
      const other = view.client.fetchQuery({ queryKey: [...CAPABILITY_INVENTORY_KEY, 'independent'], queryFn: async ({ signal }) => {
        otherSignal = signal;
        await new Promise<void>(resolve => { releaseOther = resolve; });
        return 'independent';
      } });
      try {
        await view.show([false]); await flush();
        assert.equal(view.reads.get.length, 0);
        await view.show([true]); await flush();
        assert.equal(view.reads.get.length, 1);
        await view.show([false]); await flush();
        assert.equal(view.reads.get[0]?.aborted, true);
        assert.equal(view.client.getQueryCache().find({ queryKey: CAPABILITY_INVENTORY_KEY, exact: true })?.getObserversCount(), 1, 'the page remains mounted');
        assert.equal(otherSignal.aborted, false, 'cancellation is exact and leaves independent queries alone');
        await act(async () => release()); await flush();
        assert.equal(view.reads.plans.length, 0);
        await act(async () => { await view.client.invalidateQueries({ queryKey: CAPABILITY_INVENTORY_KEY, exact: true }); });
        assert.equal(view.reads.get.length, 1, 'inactive invalidation waits for a visible consumer');
        await view.show([true]); await until(() => !view.latest.isFetching);
        assert.equal(view.reads.get.length, 2);
        assert.equal(view.reads.plans.length, 2);
      } finally { release(); releaseOther(); await other; await view.close(); }
    });

    await t.test('a same-commit visibility handoff preserves the shared request for its new visible consumer', async () => {
      const view = await mount();
      const release = view.hold();
      view.client.setQueryData(CAPABILITY_INVENTORY_KEY, cached, { updatedAt: Date.now() - 30_000 });
      try {
        await view.show([true, false]); await flush();
        await view.show([false, true]); await flush();
        assert.equal(view.reads.get.length, 1);
        assert.equal(view.reads.get[0]?.aborted, false);
        await act(async () => release()); await until(() => !view.latest.isFetching);
        assert.equal(view.reads.plans.length, 2);
      } finally { release(); await view.close(); }
    });

    await t.test('unmounting the last visible consumer cancels even when a disabled keep-alive observer remains', async () => {
      const view = await mount();
      const release = view.hold();
      view.client.setQueryData(CAPABILITY_INVENTORY_KEY, cached, { updatedAt: Date.now() - 30_000 });
      try {
        await view.show([false, true]); await flush();
        await view.show([false]); await flush();
        assert.equal(view.reads.get[0]?.aborted, true);
        await act(async () => release()); await flush();
        assert.equal(view.reads.plans.length, 0);
      } finally { release(); await view.close(); }
    });

    await t.test('a late refetch from a hidden page is cancelled without affecting task state', async () => {
      const view = await mount();
      const release = view.hold();
      view.client.setQueryData(CAPABILITY_INVENTORY_KEY, cached);
      try {
        await view.show([false]);
        let late!: ReturnType<typeof view.latest.refetch>;
        await act(async () => { late = view.latest.refetch(); });
        await until(() => view.reads.get[0]?.aborted === true);
        await act(async () => release()); await late;
        assert.equal(view.reads.plans.length, 0);
      } finally { release(); await view.close(); }
    });
  } finally {
    dom.window.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
