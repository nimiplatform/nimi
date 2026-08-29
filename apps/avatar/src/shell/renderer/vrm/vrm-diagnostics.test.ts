// Contract tests for .nimi/spec/avatar/embodiment-surface.authority.yaml.
//
// Verifies the module-local diagnostics snapshot and the frameStats boundary
// (visibleDrawableCount stays null). The concrete runtime is never published
// through a renderer global.

import { describe, expect, it } from 'vitest';
import type { VrmRuntime, VrmRenderState } from './vrm-runtime.js';
import {
  attachVrmDiagnostics,
  getVrmDiagnosticsSnapshot,
  updateVrmDiagnosticsFrameStats,
} from './vrm-diagnostics.js';

function makeMockRuntime(initial: VrmRenderState = { kind: 'idle' }): {
  runtime: VrmRuntime;
  setState(state: VrmRenderState): void;
} {
  let state: VrmRenderState = initial;
  const listeners = new Set<(s: VrmRenderState) => void>();
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
  function setState(next: VrmRenderState): void {
    state = next;
    for (const l of listeners) l(state);
  }
  return { runtime, setState };
}

describe('attachVrmDiagnostics', () => {
  it('keeps the runtime module-local without publishing a private global', () => {
    delete (globalThis as { nimi?: unknown }).nimi;
    const { runtime } = makeMockRuntime();
    const detach = attachVrmDiagnostics(runtime);
    expect(getVrmDiagnosticsSnapshot()?.state).toBe('idle');
    expect((globalThis as { nimi?: unknown }).nimi).toBeUndefined();
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

  it('detach clears the active module-local runtime', () => {
    const { runtime } = makeMockRuntime();
    const detach = attachVrmDiagnostics(runtime);
    detach();
    expect(getVrmDiagnosticsSnapshot()).toBeNull();
  });

  it('getVrmDiagnosticsSnapshot returns null before any runtime is attached', () => {
    expect(getVrmDiagnosticsSnapshot()).toBeNull();
  });

});

describe('attachVrmDiagnostics environment independence', () => {
  it('keeps the bounded module-local snapshot available without window', () => {
    const original = (globalThis as { window?: unknown }).window;
    try {
      (globalThis as { window?: unknown }).window = undefined;
      const { runtime } = makeMockRuntime();
      const detach = attachVrmDiagnostics(runtime);
      expect(typeof detach).toBe('function');
      expect(getVrmDiagnosticsSnapshot()?.state).toBe('idle');
      expect((globalThis as { nimi?: unknown }).nimi).toBeUndefined();
      detach();
    } finally {
      (globalThis as { window?: unknown }).window = original;
    }
  });
});
