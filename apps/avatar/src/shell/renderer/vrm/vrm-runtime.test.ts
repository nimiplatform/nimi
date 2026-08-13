// Contract tests for .nimi/spec/avatar/embodiment-surface.authority.yaml.
//
// Verifies the VRM internal render/recovery state in isolation. Uses
// `loaderOverride` + `setTimeoutFn` + `clearTimeoutFn` + `nowFn` test
// seams to drive the machine without R3F / WebGL / real timers.

import type { VRM } from '@pixiv/three-vrm';
import { describe, expect, it, vi } from 'vitest';
import type { VrmAvatarModelManifest } from './vrm-model-manifest.js';
import {
  createVrmRuntime,
  VRM_CONTEXT_LOST_RETRY_MS,
  type VrmRenderState,
} from './vrm-runtime.js';

function manifest(): VrmAvatarModelManifest {
  return {
    kind: 'vrm',
    modelId: 'avatar-sample',
    runtimeDir: '/models/sample/runtime',
    nimiDir: null,
    posterPath: null,
    vrm: {
      vrmFile: '/models/sample/runtime/avatar.vrm',
      motionPresetsDir: '/models/sample/runtime/motions',
    },
  };
}

function stubVrm(): VRM {
  // The state machine treats the VRM as opaque; only identity matters.
  return { __stub: true } as unknown as VRM;
}

type FakeTimerSeam = {
  setTimeoutFn: (handler: () => void, ms: number) => unknown;
  clearTimeoutFn: (handle: unknown) => void;
  fire(): void;
  pending(): boolean;
};

function makeFakeTimer(): FakeTimerSeam {
  let pending: { handler: () => void; handle: number } | null = null;
  let nextHandle = 1;
  return {
    setTimeoutFn: (handler) => {
      const handle = nextHandle++;
      pending = { handler, handle };
      return handle;
    },
    clearTimeoutFn: (handle) => {
      if (pending && pending.handle === handle) pending = null;
    },
    fire(): void {
      if (!pending) throw new Error('no pending timer to fire');
      const { handler } = pending;
      pending = null;
      handler();
    },
    pending(): boolean {
      return pending !== null;
    },
  };
}

describe('createVrmRuntime', () => {
  it('start() transitions idle -> loading -> ready', async () => {
    const vrm = stubVrm();
    const runtime = createVrmRuntime({
      manifest: manifest(),
      loaderOverride: async () => vrm,
    });
    const states: VrmRenderState[] = [];
    runtime.subscribe((s) => states.push(s));
    expect(runtime.getState().kind).toBe('idle');
    await runtime.start();
    expect(runtime.getState().kind).toBe('ready');
    // First state pushed at subscribe time (idle), then loading, then ready.
    expect(states.map((s) => s.kind)).toEqual(['idle', 'loading', 'ready']);
  });

  it('start() loader rejection -> failed_closed with reason load_failed', async () => {
    const runtime = createVrmRuntime({
      manifest: manifest(),
      loaderOverride: async () => {
        throw new Error('boom');
      },
    });
    await runtime.start();
    expect(runtime.getState()).toMatchObject({ kind: 'failed_closed', reason: 'load_failed' });
  });

  it('context lost -> timer fires -> retry succeeds -> ready', async () => {
    const vrm = stubVrm();
    const timer = makeFakeTimer();
    let nowMs = 1_000_000;
    const runtime = createVrmRuntime({
      manifest: manifest(),
      loaderOverride: async () => vrm,
      setTimeoutFn: timer.setTimeoutFn,
      clearTimeoutFn: timer.clearTimeoutFn,
      nowFn: () => nowMs,
    });
    await runtime.start();
    expect(runtime.getState().kind).toBe('ready');

    runtime.notifyContextLost();
    expect(runtime.getState().kind).toBe('context_lost');
    expect(timer.pending()).toBe(true);

    // Advance virtual clock by exactly the retry window.
    nowMs += VRM_CONTEXT_LOST_RETRY_MS;
    timer.fire();
    // Loader is async; flush microtasks so the retry promise resolves.
    await Promise.resolve();
    await Promise.resolve();

    expect(runtime.getState().kind).toBe('ready');
  });

  it('context_lost -> second context_lost before timer -> failed_closed (context_lost_twice)', async () => {
    const vrm = stubVrm();
    const timer = makeFakeTimer();
    const runtime = createVrmRuntime({
      manifest: manifest(),
      loaderOverride: async () => vrm,
      setTimeoutFn: timer.setTimeoutFn,
      clearTimeoutFn: timer.clearTimeoutFn,
    });
    await runtime.start();

    runtime.notifyContextLost();
    expect(timer.pending()).toBe(true);
    runtime.notifyContextLost();
    expect(runtime.getState()).toMatchObject({
      kind: 'failed_closed',
      reason: 'context_lost_twice',
    });
    expect(timer.pending()).toBe(false);
  });

  it('context_lost -> notifyContextRestored before timer does not skip mandatory retry reload', async () => {
    const vrm = stubVrm();
    const timer = makeFakeTimer();
    let nowMs = 5_000;
    const runtime = createVrmRuntime({
      manifest: manifest(),
      loaderOverride: async () => vrm,
      setTimeoutFn: timer.setTimeoutFn,
      clearTimeoutFn: timer.clearTimeoutFn,
      nowFn: () => nowMs,
    });
    await runtime.start();

    runtime.notifyContextLost();
    expect(timer.pending()).toBe(true);
    nowMs += 200; // browser auto-recovery well before 1500ms
    runtime.notifyContextRestored();
    expect(timer.pending()).toBe(true);
    expect(runtime.getState().kind).toBe('context_lost');

    nowMs += VRM_CONTEXT_LOST_RETRY_MS - 200;
    timer.fire();
    await Promise.resolve();
    await Promise.resolve();

    expect(runtime.getState().kind).toBe('ready');
  });

  it('context_lost -> timer fires -> retry rejects -> failed_closed (context_lost_recovery_failed)', async () => {
    const vrm = stubVrm();
    let calls = 0;
    const timer = makeFakeTimer();
    const runtime = createVrmRuntime({
      manifest: manifest(),
      loaderOverride: async () => {
        calls += 1;
        if (calls === 1) return vrm;
        throw new Error('gpu-stale');
      },
      setTimeoutFn: timer.setTimeoutFn,
      clearTimeoutFn: timer.clearTimeoutFn,
    });
    await runtime.start();
    runtime.notifyContextLost();
    timer.fire();
    await Promise.resolve();
    await Promise.resolve();
    expect(runtime.getState()).toMatchObject({
      kind: 'failed_closed',
      reason: 'context_lost_recovery_failed',
    });
  });

  it('shutdown() cancels pending retry timer', async () => {
    const vrm = stubVrm();
    const timer = makeFakeTimer();
    const runtime = createVrmRuntime({
      manifest: manifest(),
      loaderOverride: async () => vrm,
      setTimeoutFn: timer.setTimeoutFn,
      clearTimeoutFn: timer.clearTimeoutFn,
    });
    await runtime.start();
    runtime.notifyContextLost();
    expect(timer.pending()).toBe(true);
    runtime.shutdown();
    expect(timer.pending()).toBe(false);
  });

  it('ignores an initial load that resolves after shutdown', async () => {
    let resolveLoad!: (vrm: VRM) => void;
    const runtime = createVrmRuntime({
      manifest: manifest(),
      loaderOverride: () => new Promise((resolve) => {
        resolveLoad = resolve;
      }),
    });
    const states: VrmRenderState[] = [];
    runtime.subscribe((state) => states.push(state));

    const start = runtime.start();
    runtime.shutdown();
    resolveLoad(stubVrm());
    await start;

    expect(states.map((state) => state.kind)).toEqual(['idle', 'loading']);
  });

  it('subscribe() pushes the current state immediately', () => {
    const runtime = createVrmRuntime({
      manifest: manifest(),
      loaderOverride: async () => stubVrm(),
    });
    const seen: VrmRenderState[] = [];
    const off = runtime.subscribe((s) => seen.push(s));
    expect(seen).toHaveLength(1);
    expect(seen[0]?.kind).toBe('idle');
    off();
  });
});
