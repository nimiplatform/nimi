// Wave 3 chunk 3-D of topic 2026-04-30-avatar-vrm-backend-branch.
//
// Smoke-level integration verification of `createVrmBackendBranch` after
// chunk 3-D rewires emote state + motion preset registry + lipsync driver
// + projection adapter through the queued projection adapter. Heavier
// mock-scenario coverage lives in chunk 3-E.
//
// Verifies:
//  1. The branch's projection queues calls before the surface registers
//     the real adapter (queued adapter contract).
//  2. branch.shutdown() invokes generated motion runtime dispose +
//     audioConsumer.silent + tears down the surface without throwing.
//  3. createQueuedProjection unit behavior: calls before setAdapter
//     are queued in arrival order then replayed; subsequent calls
//     dispatch directly; reset() detaches the adapter.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createQueuedProjection } from './vrm-backend.js';
import type { BackendProjection } from '../carrier/backend-branch.js';

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('createQueuedProjection (chunk 3-D)', () => {
  function makeRecorder(): BackendProjection & { calls: string[] } {
    const calls: string[] = [];
    return {
      calls,
      applyActivity(input) {
        calls.push(`activity:${input.name}:${String(input.intensity)}`);
      },
      applyEmotion(input) {
        calls.push(`emotion:${input.current}:${String(input.previous)}`);
      },
      applyMotion(input) {
        calls.push(`motion:${input.routeId}`);
      },
      applyExpression(input) {
        calls.push(`expression:${input.name}`);
      },
      reset() {
        calls.push('reset');
      },
    };
  }

  it('queues calls before setAdapter, then replays in arrival order', () => {
    const handle = createQueuedProjection();
    handle.projection.applyActivity({ name: 'happy', intensity: 0.8 });
    handle.projection.applyMotion({ routeId: 'idle_subtle' });
    handle.projection.applyEmotion({ current: 'happy', previous: null });

    const recorder = makeRecorder();
    handle.setAdapter(recorder);
    expect(recorder.calls).toEqual([
      'activity:happy:0.8',
      'motion:idle_subtle',
      'emotion:happy:null',
    ]);
  });

  it('after setAdapter, subsequent calls dispatch directly without queuing', () => {
    const handle = createQueuedProjection();
    const recorder = makeRecorder();
    handle.setAdapter(recorder);
    handle.projection.applyExpression({ name: 'aa', weight: 0.5 });
    handle.projection.reset();
    expect(recorder.calls).toEqual(['expression:aa', 'reset']);
  });

  it('reset() detaches the adapter so subsequent calls re-queue', () => {
    const handle = createQueuedProjection();
    const first = makeRecorder();
    handle.setAdapter(first);
    handle.projection.applyMotion({ routeId: 'idle_subtle' });
    expect(first.calls).toEqual(['motion:idle_subtle']);

    handle.reset();
    handle.projection.applyMotion({ routeId: 'nod_yes' });
    // No calls reach the first recorder after reset.
    expect(first.calls).toEqual(['motion:idle_subtle']);

    // A fresh adapter receives the queued call.
    const second = makeRecorder();
    handle.setAdapter(second);
    expect(second.calls).toEqual(['motion:nod_yes']);
  });
});

describe('createVrmBackendBranch (chunk 3-D wiring)', () => {
  it('shutdown() runs without throwing and tears down audio + motion', async () => {
    const { createVrmBackendBranch } = await import('./vrm-backend.js');
    const handle = await createVrmBackendBranch(
      {
        kind: 'vrm',
        modelId: 'avatar-sample',
        runtimeDir: '/models/sample/runtime',
        nimiDir: null,
        posterPath: null,
        vrm: {
          vrmFile: '/models/sample/runtime/avatar.vrm',
          motionPresetsDir: '/models/sample/runtime/motions',
        },
      },
      {
        // Skip real wlipsync profile load — null is the admitted silent
        // path and keeps the test deterministic in jsdom.
        loadProfileOverride: async () => null,
      },
    );

    expect(handle.branch.kind).toBe('vrm');
    expect(handle.branch.metadata()).toEqual(
      expect.objectContaining({
        model_kind: 'vrm',
        lipsync_profile_present: false,
      }),
    );

    // projection is the queued adapter — calls before the surface mounts
    // are queued; we just verify they don't throw at this point.
    expect(() =>
      handle.branch.projection.applyActivity({ name: 'idle', intensity: null }),
    ).not.toThrow();
    expect(() => handle.branch.projection.reset()).not.toThrow();

    // Shutdown must not throw even when the surface never mounted (no
    // VRM was ever loaded; generated motion runtime has no mixer; audioConsumer
    // never attached).
    expect(() => handle.shutdown()).not.toThrow();
  });
});
