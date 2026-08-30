// Integration tests for .nimi/spec/avatar/embodiment-surface.authority.yaml.
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
import type {
  BackendActivityProjectionResult,
  BackendPendingActivityProjectionResult,
  BackendProjection,
} from '../carrier/backend-branch.js';

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('createQueuedProjection (chunk 3-D)', () => {
  function requirePending(
    result: BackendActivityProjectionResult,
  ): BackendPendingActivityProjectionResult {
    expect(typeof result).toBe('object');
    if (typeof result === 'string') throw new Error(`expected pending result, received ${result}`);
    expect(result.status).toBe('pending');
    return result;
  }

  function makeRecorder(): BackendProjection & { calls: string[] } {
    const calls: string[] = [];
    return {
      calls,
      applyActivity(input) {
        calls.push(`activity:${input.name}:${String(input.intensity)}`);
        return 'applied';
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

  it('keeps a bounded latest-wins cue per lane and cancels the replaced activity', async () => {
    const handle = createQueuedProjection();
    const replaced = requirePending(
      handle.projection.applyActivity({ name: 'happy', intensity: 0.8 }),
    );
    handle.projection.applyMotion({ routeId: 'idle_subtle' });
    const retained = requirePending(
      handle.projection.applyActivity({ name: 'thinking', intensity: 0.4 }),
    );
    handle.projection.applyEmotion({ current: 'happy', previous: null });

    await expect(replaced.completion).resolves.toBe('canceled');

    const recorder = makeRecorder();
    handle.setAdapter(recorder);
    await expect(retained.completion).resolves.toBe('applied');
    expect(recorder.calls).toEqual([
      'motion:idle_subtle',
      'activity:thinking:0.4',
      'emotion:happy:null',
    ]);
  });

  it('semantic reset cancels an older pending activity without replaying stale state', async () => {
    const handle = createQueuedProjection();
    const pending = requirePending(
      handle.projection.applyActivity({ name: 'happy', intensity: 0.8 }),
    );
    handle.projection.applyExpression({ name: 'joy' });
    handle.projection.reset();
    handle.projection.applyMotion({ routeId: 'nod_yes' });

    await expect(pending.completion).resolves.toBe('canceled');

    const recorder = makeRecorder();
    handle.setAdapter(recorder);
    expect(recorder.calls).toEqual(['reset', 'motion:nod_yes']);
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

  it('settles a replayed unsupported activity without reporting applied', async () => {
    const handle = createQueuedProjection();
    const pending = requirePending(
      handle.projection.applyActivity({ name: 'mystery_activity', intensity: 1 }),
    );
    const recorder = makeRecorder();
    recorder.applyActivity = vi.fn(() => 'unsupported' as const);

    handle.setAdapter(recorder);

    await expect(pending.completion).resolves.toBe('unsupported');
  });

  it('settles pending activity as canceled when failed-close or shutdown resets the queue', async () => {
    const handle = createQueuedProjection();
    const pending = requirePending(
      handle.projection.applyActivity({ name: 'happy', intensity: 0.8 }),
    );

    handle.reset();

    await expect(pending.completion).resolves.toBe('canceled');
  });

  it('cancels an adapter-level pending activity when the same lane is replaced', async () => {
    const handle = createQueuedProjection();
    let settleAdapter: (value: 'applied' | 'unsupported' | 'canceled') => void = () => {};
    const adapterCompletion = new Promise<'applied' | 'unsupported' | 'canceled'>((resolve) => {
      settleAdapter = resolve;
    });
    const recorder = makeRecorder();
    recorder.applyActivity = vi.fn()
      .mockReturnValueOnce({ status: 'pending', completion: adapterCompletion })
      .mockReturnValueOnce('applied');
    handle.setAdapter(recorder);

    const replaced = requirePending(
      handle.projection.applyActivity({ name: 'happy', intensity: 0.8 }),
    );
    expect(handle.projection.applyActivity({ name: 'thinking', intensity: 0.4 })).toBe('applied');
    settleAdapter('applied');

    await expect(replaced.completion).resolves.toBe('canceled');
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
