import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import type { DesktopParentMonitorProcess } from '../src/main/app-bridge.js';

type FakeHost = DesktopParentMonitorProcess & { ppid: number; readonly signals: Array<[number, string | number]>; readonly exits: number[]; alive: Set<number> };

function fakeHost(overrides: Partial<Pick<FakeHost, 'platform' | 'env' | 'defaultApp' | 'ppid'>> = {}): FakeHost {
  const host = {
    platform: 'darwin' as NodeJS.Platform,
    env: { NIMI_APP_HOST_PROFILE_DIR: '/Users/u/Nimi/hosts/app' } as Record<string, string | undefined>,
    defaultApp: false,
    pid: 5000,
    ppid: 4242,
    signals: [] as Array<[number, string | number]>,
    exits: [] as number[],
    alive: new Set([4242, 5000]),
    kill(pid: number, signal: NodeJS.Signals | 0) {
      host.signals.push([pid, signal]);
      if (signal === 0 && !host.alive.has(pid)) throw Object.assign(new Error('ESRCH'), { code: 'ESRCH' });
      return true;
    },
    exit(code: number) { host.exits.push(code); },
    ...overrides,
  };
  return host;
}

async function loadMonitor() {
  vi.resetModules();
  return (await import('../src/main/app-bridge.js'));
}

// The first import transforms the whole bridge graph; warm it once so each
// test's fresh module instance loads quickly under a busy suite.
beforeAll(async () => { await import('../src/main/app-bridge.js'); }, 60_000);
beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

it('an installed Host launched by Desktop quits when Desktop is gone, and leaves if the quit is held', async () => {
  const { startDesktopParentMonitor, DESKTOP_PARENT_LOSS_EXIT_BUDGET_MS } = await loadMonitor();
  const host = fakeHost();
  startDesktopParentMonitor(host);
  await vi.advanceTimersByTimeAsync(1_000);
  expect(host.signals.filter(([, signal]) => signal === 'SIGTERM')).toEqual([]);

  host.ppid = 1;
  host.alive.delete(4242);
  await vi.advanceTimersByTimeAsync(250);
  expect(host.signals.filter(([, signal]) => signal === 'SIGTERM')).toEqual([[5000, 'SIGTERM']]);
  expect(host.exits).toEqual([]);

  await vi.advanceTimersByTimeAsync(DESKTOP_PARENT_LOSS_EXIT_BUDGET_MS);
  expect(host.exits).toEqual([1]);
  await vi.advanceTimersByTimeAsync(5_000);
  expect(host.signals.filter(([, signal]) => signal === 'SIGTERM')).toHaveLength(1);
});

it('a dead parent pid counts as lost even before the Host is reparented', async () => {
  const { startDesktopParentMonitor } = await loadMonitor();
  const host = fakeHost();
  startDesktopParentMonitor(host);
  host.alive.delete(4242);
  await vi.advanceTimersByTimeAsync(250);
  expect(host.signals).toContainEqual([5000, 'SIGTERM']);
});

it('a process Desktop did not launch is left alone', async () => {
  const { startDesktopParentMonitor } = await loadMonitor();
  const host = fakeHost({ env: {}, ppid: 1 });
  expect(() => startDesktopParentMonitor(host)).not.toThrow();
  await vi.advanceTimersByTimeAsync(5_000);
  expect(host.signals).toEqual([]);
  expect(host.exits).toEqual([]);
});

it('a Desktop-launched Host whose Desktop already died refuses to start', async () => {
  const { startDesktopParentMonitor } = await loadMonitor();
  expect(() => startDesktopParentMonitor(fakeHost({ ppid: 1 })))
    .toThrow(expect.objectContaining({ reasonCode: 'electron-local-app-parent-required' }));
});

it('the source development profile keeps its default-app requirement on macOS', async () => {
  const { startDesktopParentMonitor } = await loadMonitor();
  const sourceEnv = { NIMI_MACOS_SOURCE_LOCAL_DEVELOPMENT: '1', NIMI_APP_HOST_PROFILE_DIR: '/p' };
  expect(() => startDesktopParentMonitor(fakeHost({ env: sourceEnv, defaultApp: false })))
    .toThrow(expect.objectContaining({ reasonCode: 'electron-local-app-parent-required' }));
  const { startDesktopParentMonitor: again } = await loadMonitor();
  expect(() => again(fakeHost({ env: sourceEnv, defaultApp: true }))).not.toThrow();
});
