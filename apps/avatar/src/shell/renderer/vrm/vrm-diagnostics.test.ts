// Contract tests for .nimi/spec/avatar/kernel/vrm-backend-contract.md.
//
// Verifies the diagnostics module: window global wiring, snapshot shape,
// SSR-safe attach, and the frameStats boundary (visibleDrawableCount
// stays null), and detach removes the global.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { VrmRuntime, VrmLifecycleState } from './vrm-runtime.js';
import {
  attachVrmDiagnostics,
  getVrmDiagnosticsSnapshot,
  updateVrmDiagnosticsFrameStats,
} from './vrm-diagnostics.js';
import { clearVrmCache } from './vrm-instance-cache.js';

type DebugGlobal = {
  snapshot: () => unknown;
  runtime: VrmRuntime;
};

function getDebugGlobal(): DebugGlobal | undefined {
  return (globalThis as { nimi?: { avatar?: { vrm?: { debug?: DebugGlobal } } } }).nimi?.avatar
    ?.vrm?.debug;
}

function makeMockRuntime(initial: VrmLifecycleState = { kind: 'idle' }): {
  runtime: VrmRuntime;
  setState(state: VrmLifecycleState): void;
} {
  let state: VrmLifecycleState = initial;
  const listeners = new Set<(s: VrmLifecycleState) => void>();
  const runtime: VrmRuntime = {
    async start() {},
    shutdown() {},
    getState() {
      return state;
    },
    notifyContextLost() {},
    notifyContextRestored() {},
    subscribe(listener) {
      listeners.add(listener);
      listener(state);
      return () => listeners.delete(listener);
    },
  };
  function setState(next: VrmLifecycleState): void {
    state = next;
    for (const l of listeners) l(state);
  }
  return { runtime, setState };
}

beforeEach(() => {
  clearVrmCache();
});

afterEach(() => {
  // Make sure the global namespace never leaks between tests — wipe the
  // entire `nimi` shell so a leftover `{avatar: {vrm: {}}}` from a prior
  // attach-then-detach doesn't fail the SSR-safety assertion below.
  delete (globalThis as { nimi?: unknown }).nimi;
});

describe('attachVrmDiagnostics', () => {
  it('writes window.nimi.avatar.vrm.debug.snapshot when window is available', () => {
    const { runtime } = makeMockRuntime();
    const detach = attachVrmDiagnostics(runtime);
    const dbg = getDebugGlobal();
    expect(dbg).toBeDefined();
    expect(typeof dbg?.snapshot).toBe('function');
    expect(dbg?.runtime).toBe(runtime);
    detach();
  });

  it('snapshot reflects the current runtime state', () => {
    const { runtime, setState } = makeMockRuntime({ kind: 'idle' });
    const detach = attachVrmDiagnostics(runtime);
    let snap = getVrmDiagnosticsSnapshot();
    expect(snap?.state).toBe('idle');
    expect(snap?.vrmLoaded).toBe(false);
    expect(snap?.retryAttempted).toBe(false);

    // Transition to ready
    const fakeVrm = { scene: {} } as unknown as import('@pixiv/three-vrm').VRM;
    const fakeManifest = {
      kind: 'vrm' as const,
      modelId: 'm',
      runtimeDir: '/r',
      nimiDir: null,
      posterPath: null,
      vrm: { vrmFile: '/r/m.vrm', motionPresetsDir: null },
    };
    setState({ kind: 'ready', manifest: fakeManifest, vrm: fakeVrm });
    snap = getVrmDiagnosticsSnapshot();
    expect(snap?.state).toBe('ready');
    expect(snap?.vrmLoaded).toBe(true);

    // context_lost retried=false
    setState({
      kind: 'context_lost',
      manifest: fakeManifest,
      vrm: fakeVrm,
      lostAt: 0,
      retried: false,
    });
    snap = getVrmDiagnosticsSnapshot();
    expect(snap?.state).toBe('context_lost');
    expect(snap?.retryAttempted).toBe(false);
    expect(snap?.vrmLoaded).toBe(true);

    // context_lost retried=true
    setState({
      kind: 'context_lost',
      manifest: fakeManifest,
      vrm: fakeVrm,
      lostAt: 0,
      retried: true,
    });
    snap = getVrmDiagnosticsSnapshot();
    expect(snap?.retryAttempted).toBe(true);

    detach();
  });

  it('keeps frameStats.visibleDrawableCount null because visual acceptance owns pixels', () => {
    const { runtime } = makeMockRuntime();
    const detach = attachVrmDiagnostics(runtime);
    updateVrmDiagnosticsFrameStats({ framedHeight: 1.5, framedWidth: 0.7 });
    const snap = getVrmDiagnosticsSnapshot();
    expect(snap?.frameStats.visibleDrawableCount).toBeNull();
    expect(snap?.frameStats.framedHeight).toBeCloseTo(1.5, 5);
    expect(snap?.frameStats.framedWidth).toBeCloseTo(0.7, 5);
    detach();
  });

  it('detach removes the window global and clears the active runtime', () => {
    const { runtime } = makeMockRuntime();
    const detach = attachVrmDiagnostics(runtime);
    expect(getDebugGlobal()).toBeDefined();
    detach();
    expect(getDebugGlobal()).toBeUndefined();
    expect(getVrmDiagnosticsSnapshot()).toBeNull();
  });

  it('getVrmDiagnosticsSnapshot returns null before any runtime is attached', () => {
    expect(getVrmDiagnosticsSnapshot()).toBeNull();
  });

  it('snapshot includes cache stats', () => {
    const { runtime } = makeMockRuntime();
    const detach = attachVrmDiagnostics(runtime);
    const snap = getVrmDiagnosticsSnapshot();
    expect(snap?.cacheStats).toEqual({ size: 0, urls: [] });
    detach();
  });
});

describe('attachVrmDiagnostics SSR safety', () => {
  it('returns a no-op detach without throwing when window is undefined', async () => {
    // jsdom keeps window attached on globalThis. We patch it to undefined
    // for a single test and restore in finally.
    const original = (globalThis as { window?: unknown }).window;
    try {
      (globalThis as { window?: unknown }).window = undefined;
      const { runtime } = makeMockRuntime();
      // Re-import the module to see the SSR branch — but the runtime
      // check uses `typeof window` directly so the existing import works.
      const detach = attachVrmDiagnostics(runtime);
      expect(typeof detach).toBe('function');
      // Should not have thrown, and should not have written to globalThis.
      expect((globalThis as { nimi?: unknown }).nimi).toBeUndefined();
      detach(); // also no-throw
    } finally {
      (globalThis as { window?: unknown }).window = original;
    }
  });
});
