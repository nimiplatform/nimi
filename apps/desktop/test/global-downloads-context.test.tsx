import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { JSDOM } from 'jsdom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { DesktopCanonicalRendererBindings } from '../src/shell/renderer/renderer/contract.js';
import { DesktopRendererBindingProvider } from '../src/shell/renderer/renderer/binding-context.js';
import { GlobalDownloadsProvider, useGlobalDownloads } from '../src/shell/renderer/features/runtime-config/global-downloads-context.js';
import { useRuntimeConfigLocalEnvironmentClient } from '../src/shell/renderer/features/runtime-config/runtime-config-local-environment-sdk-service.js';
import { createRuntimeSetupTaskRunnerPorts } from '../src/shell/renderer/features/runtime-config/runtime-setup-task-ports.js';

test('local task creation wakes idle Downloads before appearing in Runtime and releases polling on settlement', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost', pretendToBeVisual: true });
  const values = {
    window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    React, IS_REACT_ACT_ENVIRONMENT: true,
  };
  const previous = new Map(Object.keys(values).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(values)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  let timer: { callback: () => void; delay: number } | undefined;
  dom.window.setTimeout = ((callback: () => void, delay: number) => { timer = { callback, delay }; return 1; }) as typeof dom.window.setTimeout;
  dom.window.clearTimeout = () => { timer = undefined; };
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  const { createRoot } = await import('react-dom/client');
  const root = createRoot(dom.window.document.getElementById('root')!);
  const pending: ((error: Error) => void)[] = [];
  let reads = 0;
  let transfers: { installSessionId: string; state: string }[] = [];
  const bindings = {
    sdk: {
      localEnvironmentRpc: () => ({
        listLocalTransfers: async () => { reads += 1; return { transfers }; },
        listLocalEnvironmentDependencyJobs: async () => ({ jobs: [] }),
        installModelFromPlan: () => new Promise((_resolve, reject) => pending.push(reject)),
        applyLocalEnvironmentPlan: () => new Promise((_resolve, reject) => pending.push(reject)),
      }),
      machineProduct: () => ({ local: { loadouts: {} } }),
    },
    app: { commands: { firstRun: { getRecord: async () => ({ record: { dataRoot: { rootActivationId: 'test-root' } } }) } } },
  } as unknown as DesktopCanonicalRendererBindings;
  let client!: ReturnType<typeof useRuntimeConfigLocalEnvironmentClient>;
  let setup!: ReturnType<typeof createRuntimeSetupTaskRunnerPorts>;
  let downloads!: NonNullable<ReturnType<typeof useGlobalDownloads>>;
  function Consumer() {
    client = useRuntimeConfigLocalEnvironmentClient();
    setup = createRuntimeSetupTaskRunnerPorts(bindings.sdk, client);
    downloads = useGlobalDownloads()!;
    return <span>{downloads.activeCount}</span>;
  }
  const settle = async () => {
    await new Promise<void>((resolve) => setImmediate(resolve));
    // Concurrent mutations coalesce into one immediate follow-up read.
    if (timer?.delay === 0) {
      timer.callback();
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
  };
  try {
    await act(async () => {
      root.render(<QueryClientProvider client={queryClient}>
        <DesktopRendererBindingProvider bindings={bindings}>
          <GlobalDownloadsProvider><Consumer /></GlobalDownloadsProvider>
        </DesktopRendererBindingProvider>
      </QueryClientProvider>);
    });
    await act(settle);
    assert.equal(timer?.delay, 30_000);
    assert.equal(downloads.activeCount, 0);
    const idleReads = reads;
    let first!: Promise<unknown>, second!: Promise<unknown>, environment!: Promise<unknown>;
    await act(async () => {
      first = client.install('market-plan', { caller: 'core' }).catch((error: unknown) => error);
      second = setup.install.install('setup-plan', { caller: 'core' }).catch((error: unknown) => error);
      environment = setup.environment.applyEnvironmentPlan({
        resolution: { capabilityContract: 'text.generate' }, expectedPlanId: 'environment-plan', confirmed: true,
      }, { caller: 'core' }).catch((error: unknown) => error);
      await settle();
    });
    assert.ok(reads > idleReads, 'same-window install must wake the idle observer');
    assert.equal(timer?.delay, 2_000, 'poll promptly even before Runtime lists either task');
    assert.equal(downloads.activeCount, 0, 'pending RPCs must not invent Runtime jobs');
    const failure = new Error('first install rejected');
    await act(async () => { pending[0]!(failure); await first; await settle(); });
    assert.equal(await first, failure, 'observer must preserve the install error');
    assert.equal(timer?.delay, 2_000, 'one rejection must not stop observing the other pending install');
    transfers = [{ installSessionId: 'new-transfer', state: 'running' }];
    await act(async () => { timer?.callback(); await settle(); });
    assert.equal(downloads.activeCount, 1);
    assert.equal(downloads.transfers[0]?.installSessionId, 'new-transfer');
    transfers = [{ installSessionId: 'new-transfer', state: 'cancelled' }];
    const cancelled = new Error('second install cancelled');
    await act(async () => { pending[1]!(cancelled); await second; await settle(); });
    assert.equal(await second, cancelled);
    assert.equal(downloads.activeCount, 0);
    assert.equal(timer?.delay, 2_000, 'environment preparation must also keep the observer awake');
    await act(async () => { pending[2]!(cancelled); await environment; await settle(); });
    assert.equal(await environment, cancelled);
    assert.equal(timer?.delay, 30_000, 'settled tasks must restore idle polling');
    const settledReads = reads;
    await act(async () => { await downloads.refresh(); await settle(); });
    assert.ok(reads > settledReads, 'opening Downloads can explicitly refresh the idle observer');
  } finally {
    await act(async () => root.unmount());
    queryClient.clear();
    dom.window.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
