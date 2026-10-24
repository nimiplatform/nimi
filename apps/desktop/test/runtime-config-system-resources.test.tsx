import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { JSDOM } from 'jsdom';
import { DesktopRendererBindingProvider } from '../src/shell/renderer/renderer/binding-context.js';
import type { DesktopCanonicalRendererBindings } from '../src/shell/renderer/renderer/contract.js';
import type { DesktopSystemResourceSnapshot } from '../src/shell/renderer/renderer/system-resources-port.js';
import { useSystemResources } from '../src/shell/renderer/features/runtime-config/runtime-config-system-resources.js';
import { SystemEntryProviderContext, type SystemEntryContextValue } from '../src/shell/renderer/features/system-entry/system-entry-context.js';

test('a mounted diagnostics sampler stops while Home is hidden and ignores old reads and timers', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost' });
  const globals = { window: dom.window, document: dom.window.document, navigator: dom.window.navigator, React, IS_REACT_ACT_ENVIRONMENT: true };
  const previous = new Map(Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  const { createRoot } = await import('react-dom/client');
  const root = createRoot(dom.window.document.getElementById('root')!);
  const reads: Array<(value: DesktopSystemResourceSnapshot) => void> = [];
  const scheduled = new Set<() => void>();
  const bindings = {
    app: { commands: { systemResources: { load: () => new Promise<DesktopSystemResourceSnapshot>((resolve) => reads.push(resolve)) } } },
    clock: { now: () => 1_000, schedule: (delay: number, listener: (result: { ok: true }) => void) => {
      assert.equal(delay, 5_000);
      const tick = () => { scheduled.delete(tick); listener({ ok: true }); };
      scheduled.add(tick);
      return () => { scheduled.delete(tick); };
    } },
  } as unknown as DesktopCanonicalRendererBindings;
  function MountedSampler() {
    const resources = useSystemResources();
    return <span>{resources.snapshot?.cpuPercent ?? 'unread'}</span>;
  }
  const render = async (homeVisible: boolean) => {
    const context = { homeVisible } as SystemEntryContextValue;
    await act(async () => root.render(<DesktopRendererBindingProvider bindings={bindings}><SystemEntryProviderContext.Provider value={context}>
      <MountedSampler />
    </SystemEntryProviderContext.Provider></DesktopRendererBindingProvider>));
  };
  const finish = async (index: number, cpuPercent: number) => {
    await act(async () => reads[index]!({ cpuPercent, memoryUsedBytes: 1, memoryTotalBytes: 2, memoryPressure: 'normal',
      diskUsedBytes: null, diskTotalBytes: null, capturedAtMs: 1_000, source: 'test' }));
  };
  try {
    await render(false);
    assert.equal(reads.length, 0);
    await render(true);
    assert.equal(reads.length, 1);
    await finish(0, 12);
    assert.equal(scheduled.size, 1);
    const firstTick = [...scheduled][0]!;
    await act(async () => firstTick());
    assert.equal(reads.length, 2);
    await render(false);
    await finish(1, 99);
    assert.equal(scheduled.size, 0);
    assert.equal(dom.window.document.querySelector('span')!.textContent, '12');
    await render(true);
    assert.equal(reads.length, 3, 'restoring Home gets a fresh sample');
    await finish(2, 23);
    const staleTick = [...scheduled][0]!;
    await render(false);
    assert.equal(scheduled.size, 0);
    await act(async () => staleTick());
    assert.equal(reads.length, 3, 'a canceled timer already queued for delivery cannot restart sampling');
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
