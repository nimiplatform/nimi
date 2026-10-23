import assert from 'node:assert/strict';
import { test } from 'node:test';
import React, { act } from 'react';
import { JSDOM } from 'jsdom';
import { renderToStaticMarkup } from 'react-dom/server';
import { RuntimeHealthStatus } from '@nimiplatform/sdk/runtime/wire-types';
import { initI18n, changeLocale } from '../src/shell/renderer/i18n';
import {
  HOME_RESOURCE_WARN_PERCENT,
  HomeMachineStatusView,
  HomeMachineStatus,
  homeRuntimeState,
  type HomeMachineStatusViewProps,
} from '../src/shell/renderer/features/home/home-machine-status.js';
import type { SystemEntryUsage } from '../src/shell/shared/system-entry-types.js';
import { SystemEntryProviderContext, type SystemEntryContextValue } from '../src/shell/renderer/features/system-entry/system-entry-context.js';
import { DesktopRendererBindingProvider } from '../src/shell/renderer/renderer/binding-context.js';
import type { DesktopCanonicalRendererBindings } from '../src/shell/renderer/renderer/contract.js';

(globalThis as { React?: typeof React }).React = React;

const GB = 1024 ** 3;
function usageProjection(overrides: Partial<SystemEntryUsage> = {}): SystemEntryUsage {
  return { status: 'available', observedAt: '2026-10-23T03:00:00Z', periodLabel: '2026-10-23 · Asia/Shanghai',
    attempts: '12', localAttempts: '8', cloudAttempts: '4', costs: [{ currency: 'USD', estimate: '0.42' }],
    partial: false, note: 'Current account · this device', ...overrides };
}

function render(overrides: Partial<HomeMachineStatusViewProps> = {}): string {
  const props: HomeMachineStatusViewProps = {
    runtime: 'ready',
    resources: {
      status: 'ready',
      snapshot: {
        cpuPercent: 7,
        memoryUsedBytes: 25.3 * GB,
        memoryTotalBytes: 31.6 * GB,
        memoryPressure: 'normal',
        diskUsedBytes: 361.6 * GB,
        diskTotalBytes: 731.4 * GB,
        capturedAtMs: Date.now(),
        source: 'test',
      },
    },
    usage: usageProjection(),
    onOpenDiagnostics: () => undefined,
    onOpenUsage: () => undefined,
    ...overrides,
  };
  return renderToStaticMarkup(<HomeMachineStatusView {...props} />);
}

test('machine status strip shows Runtime resources and shared real AI usage', async () => {
  await initI18n(); await changeLocale('en');
  const html = render();
  assert.match(html, /data-testid="home-machine-status"/);
  assert.match(html, /data-testid="home-machine-runtime" data-state="ready"/);
  assert.match(html, /Runtime running/);
  assert.match(html, /CPU<\/span><span[^>]*>7%/);
  assert.match(html, /Memory<\/span><span[^>]*>80%/);
  assert.match(html, /Disk<\/span><span[^>]*>49%/);
  assert.match(html, /12 recorded AI executions/);
  assert.match(html, /Estimated 0\.42 USD/);
  assert.doesNotMatch(html, /12 req/);
  assert.doesNotMatch(html, /data-warn=/);
  assert.doesNotMatch(html, /runtimeConfig\.overview\./);
});

function snapshotWith(memoryPressure: 'normal' | 'warning' | 'critical' | 'unknown', overrides: { cpuPercent?: number; diskUsedBytes?: number } = {}) {
  return {
    status: 'ready' as const,
    snapshot: {
      cpuPercent: overrides.cpuPercent ?? 12,
      memoryUsedBytes: 124 * GB,
      memoryTotalBytes: 128 * GB,
      memoryPressure,
      diskUsedBytes: overrides.diskUsedBytes ?? 100 * GB,
      diskTotalBytes: 200 * GB,
      capturedAtMs: Date.now(),
      source: 'test',
    },
  };
}

test('a mostly occupied memory without reported pressure stays neutral', async () => {
  await initI18n(); await changeLocale('en');
  for (const pressure of ['normal', 'unknown'] as const) {
    const html = render({ resources: snapshotWith(pressure) });
    assert.match(html, /<span>Memory<\/span><span[^>]*>97%/, pressure);
    assert.doesNotMatch(html, /data-warn=/, pressure);
  }
  assert.match(render({ resources: snapshotWith('normal') }), /title="Memory pressure: Normal"><span>Memory/);
  assert.doesNotMatch(render({ resources: snapshotWith('unknown') }), /Memory pressure/);
});

test('memory is marked only when the OS reports pressure, and the mark is not color-only', async () => {
  await initI18n(); await changeLocale('en');
  for (const [pressure, label] of [['warning', 'Elevated'], ['critical', 'Critical']] as const) {
    const html = render({ resources: snapshotWith(pressure) });
    assert.equal((html.match(/data-warn="true"/g) ?? []).length, 1, pressure);
    assert.match(html, new RegExp(`data-warn="true" title="Memory pressure: ${label}"><span>Memory</span><span[^>]*>97%</span><span class="sr-only">Memory pressure: ${label}</span>`), pressure);
  }
  await changeLocale('zh');
  assert.match(render({ resources: snapshotWith('warning') }), /title="内存压力：偏高"/);
});

test('cpu and disk keep their share thresholds, without advice text', async () => {
  await initI18n(); await changeLocale('en');
  const html = render({ resources: snapshotWith('normal', { cpuPercent: 91, diskUsedBytes: 181 * GB }) });
  assert.equal((html.match(/data-warn="true"/g) ?? []).length, 2);
  assert.match(html, /data-warn="true"><span>CPU<\/span><span[^>]*>91%/);
  assert.match(html, /data-warn="true"><span>Disk<\/span><span[^>]*>91%/);
  assert.deepEqual(HOME_RESOURCE_WARN_PERCENT, { cpu: 90, disk: 90 });
});

test('machine status strip degrades per source without hiding the others', async () => {
  await initI18n(); await changeLocale('en');
  const html = render({
    runtime: 'unavailable',
    resources: { status: 'unavailable', snapshot: null },
    usage: usageProjection({ status: 'unavailable', attempts: null, localAttempts: null, cloudAttempts: null, costs: [], partial: true }),
  });
  assert.match(html, /data-state="unavailable"/);
  assert.match(html, /Runtime connection unavailable/);
  assert.match(html, /System resources unavailable/);
  assert.match(html, /Today&#x27;s AI usage unavailable/);
  assert.doesNotMatch(html, /0 recorded AI executions/);
  assert.doesNotMatch(html, /title="Some models have unknown pricing"/);
  assert.doesNotMatch(html, /%<\/span>/);
});

test('unpriced usage keeps the cost honest instead of showing zero', async () => {
  await initI18n(); await changeLocale('zh');
  const html = render({
    usage: usageProjection({ status: 'partial', attempts: '3', costs: [], partial: true, note: '部分费用未知' }),
  });
  assert.match(html, /费用暂无法估算/);
  assert.match(html, /title="部分费用未知"/);
  assert.match(html, /今日已记录 3 次 AI 执行/);
  assert.match(html, /部分/);
});

test('homeRuntimeState maps health query states to the strip states', () => {
  assert.equal(homeRuntimeState({ isPending: true, isError: false, data: undefined }), 'checking');
  assert.equal(homeRuntimeState({ isPending: false, isError: true, data: undefined }), 'unavailable');
  assert.equal(homeRuntimeState({ isPending: false, isError: false, data: { status: RuntimeHealthStatus.READY } }), 'ready');
  assert.equal(homeRuntimeState({ isPending: false, isError: false, data: { status: RuntimeHealthStatus.DEGRADED } }), 'attention');
  assert.equal(homeRuntimeState({ isPending: false, isError: false, data: { status: RuntimeHealthStatus.STOPPED } }), 'attention');
});

test('an unavailable data disk stays unknown while CPU and memory remain visible', async () => {
  await initI18n(); await changeLocale('en');
  const state = snapshotWith('normal');
  const html = render({ resources: { ...state, snapshot: { ...state.snapshot, diskUsedBytes: null, diskTotalBytes: null } } });
  assert.match(html, /Data disk unavailable/);
  assert.match(html, /12%/);
  assert.match(html, /—/);
  assert.doesNotMatch(html, /data-warn="true"/);
});

test('Home hides its resource sampler and reads usage only from the shared provider', async () => {
  await initI18n(); await changeLocale('en');
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost' });
  const globals = { window: dom.window, document: dom.window.document, navigator: dom.window.navigator, React, IS_REACT_ACT_ENVIRONMENT: true };
  const previous = new Map(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  const { createRoot } = await import('react-dom/client');
  const root = createRoot(dom.window.document.getElementById('root')!);
  let loads = 0, openedUsage = 0;
  const scheduled = new Set<() => void>();
  const bindings = {
    app: { commands: { systemResources: { load: async () => { loads += 1; return snapshotWith('normal').snapshot; } } } },
    clock: { now: Date.now, schedule: (_delay: number, listener: (result: { ok: true }) => void) => {
      const tick = () => listener({ ok: true }); scheduled.add(tick); return () => { scheduled.delete(tick); };
    } },
    sdk: { machineProduct: () => { throw new Error('Home must not read RPC Usage'); } },
  } as unknown as DesktopCanonicalRendererBindings;
  const renderVisible = async (homeVisible: boolean) => {
    const context = { homeVisible, projection: { usage: usageProjection({ attempts: '9' }) } } as SystemEntryContextValue;
    await act(async () => root.render(<DesktopRendererBindingProvider bindings={bindings}><SystemEntryProviderContext.Provider value={context}>
      <HomeMachineStatus runtime="ready" onOpenDiagnostics={() => {}} onOpenUsage={() => { openedUsage += 1; }} />
    </SystemEntryProviderContext.Provider></DesktopRendererBindingProvider>));
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
  };
  try {
    await renderVisible(false);
    assert.equal(loads, 0);
    await renderVisible(true);
    assert.equal(loads, 1); assert.equal(scheduled.size, 1);
    assert.match(dom.window.document.body.textContent ?? '', /9 recorded AI executions/);
    await act(async () => dom.window.document.querySelector<HTMLButtonElement>('[data-testid="home-machine-usage"]')!.click());
    assert.equal(openedUsage, 1);
    await renderVisible(false);
    assert.equal(scheduled.size, 0);
    assert.equal(loads, 1);
  } finally {
    await act(async () => root.unmount()); dom.window.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete (globalThis as Record<string, unknown>)[key];
    }
  }
});
