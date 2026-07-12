// Contract tests for .nimi/spec/avatar/kernel/vrm-backend-contract.md.
//
// Verifies the VRM BackendAudioConsumer (vrm-audio-consumer.ts). Mirrors
// the live2d audio consumer test patterns: stub `createWLipSyncNode` via
// the test seam, verify lazy creation + per-AudioContext caching +
// detach/silent semantics + no-profile fallback path + create-failure
// fail-close.

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Profile } from 'wlipsync';
import { createVrmAudioConsumer } from './vrm-audio-consumer.js';

/** Constructs a fake AudioWorkletNode-like object exposing only the
 *  surface the consumer reads from (`weights` / `volume`). The real
 *  worklet writes these from the audio thread; for jsdom tests we set
 *  them directly. */
function fakeNode(): AudioWorkletNode & {
  weights: Record<string, number>;
  volume: number;
} {
  return {
    weights: { A: 0, E: 0, I: 0, O: 0, U: 0, S: 0 },
    volume: 0,
  } as unknown as AudioWorkletNode & {
    weights: Record<string, number>;
    volume: number;
  };
}

function fakeAudioContext(): AudioContext {
  return {} as AudioContext;
}

function fakeSource(): AudioBufferSourceNode {
  return {
    connect: vi.fn(),
    disconnect: vi.fn(),
  } as unknown as AudioBufferSourceNode;
}

const TEST_PROFILE: Profile = { mfcc: [], visemes: [] } as unknown as Profile;

afterEach(() => {
  vi.restoreAllMocks();
});

describe('createVrmAudioConsumer', () => {
  it('snapshot returns null until first attachAudioSource creates the node', async () => {
    const consumer = createVrmAudioConsumer({
      profile: TEST_PROFILE,
      createNode: vi.fn(async () => fakeNode()),
    });
    expect(consumer.snapshot()).toBeNull();
    await consumer.attachAudioSource(fakeSource(), fakeAudioContext());
    // Node now exists; weights are zero so snapshot returns the
    // empty-but-non-null payload.
    const snap = consumer.snapshot();
    expect(snap).not.toBeNull();
    expect(snap?.weights).toEqual({ A: 0, E: 0, I: 0, O: 0, U: 0, S: 0 });
    expect(snap?.volume).toBe(0);
  });

  it('snapshot returns latest weights/volume after they update on the node', async () => {
    const node = fakeNode();
    const consumer = createVrmAudioConsumer({
      profile: TEST_PROFILE,
      createNode: vi.fn(async () => node),
    });
    await consumer.attachAudioSource(fakeSource(), fakeAudioContext());
    // Simulate the worklet writing fresh values.
    node.weights = { A: 0.4, E: 0.1, I: 0.05, O: 0.02, U: 0.01, S: 0.0 };
    node.volume = 0.6;
    const snap = consumer.snapshot();
    expect(snap?.weights.A).toBeCloseTo(0.4);
    expect(snap?.volume).toBeCloseTo(0.6);
  });

  it('attachAudioSource lazy-creates the wLipSyncNode exactly once per AudioContext', async () => {
    const create = vi.fn(async () => fakeNode());
    const consumer = createVrmAudioConsumer({
      profile: TEST_PROFILE,
      createNode: create,
    });
    const ctx = fakeAudioContext();
    await consumer.attachAudioSource(fakeSource(), ctx);
    await consumer.attachAudioSource(fakeSource(), ctx);
    await consumer.attachAudioSource(fakeSource(), ctx);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('attachAudioSource with a NEW AudioContext re-creates the wLipSyncNode', async () => {
    const create = vi.fn(async () => fakeNode());
    const consumer = createVrmAudioConsumer({
      profile: TEST_PROFILE,
      createNode: create,
    });
    await consumer.attachAudioSource(fakeSource(), fakeAudioContext());
    await consumer.attachAudioSource(fakeSource(), fakeAudioContext());
    expect(create).toHaveBeenCalledTimes(2);
  });

  it('detachAudioSource disconnects source but preserves node for reuse', async () => {
    const node = fakeNode();
    const consumer = createVrmAudioConsumer({
      profile: TEST_PROFILE,
      createNode: vi.fn(async () => node),
    });
    const source = fakeSource();
    await consumer.attachAudioSource(source, fakeAudioContext());
    expect(consumer.isAttached()).toBe(true);
    consumer.detachAudioSource();
    expect(consumer.isAttached()).toBe(false);
    expect(source.disconnect).toHaveBeenCalledWith(node);
    // Node is still queryable via snapshot (weights live on the node).
    expect(consumer.snapshot()).not.toBeNull();
  });

  it('silent() detaches and invokes the onSilent callback', async () => {
    const onSilent = vi.fn();
    const consumer = createVrmAudioConsumer({
      profile: TEST_PROFILE,
      createNode: vi.fn(async () => fakeNode()),
      onSilent,
    });
    await consumer.attachAudioSource(fakeSource(), fakeAudioContext());
    consumer.silent();
    expect(onSilent).toHaveBeenCalled();
    expect(consumer.isAttached()).toBe(false);
  });

  it('null profile path warns once and silents on attach without creating a node', async () => {
    const create = vi.fn(async () => fakeNode());
    const onSilent = vi.fn();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const consumer = createVrmAudioConsumer({
      profile: null,
      createNode: create,
      onSilent,
    });
    await consumer.attachAudioSource(fakeSource(), fakeAudioContext());
    await consumer.attachAudioSource(fakeSource(), fakeAudioContext());
    expect(create).not.toHaveBeenCalled();
    expect(onSilent).toHaveBeenCalledTimes(2);
    // Warn fires only once for the no-profile path.
    expect(warn).toHaveBeenCalledTimes(1);
    expect(consumer.snapshot()).toBeNull();
  });

  it('createNode failure logs warn, fires onSilent, leaves consumer detached', async () => {
    const onSilent = vi.fn();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const consumer = createVrmAudioConsumer({
      profile: TEST_PROFILE,
      createNode: vi.fn(async () => {
        throw new Error('worklet_load_failed');
      }),
      onSilent,
    });
    await consumer.attachAudioSource(fakeSource(), fakeAudioContext());
    expect(warn).toHaveBeenCalled();
    expect(onSilent).toHaveBeenCalled();
    expect(consumer.isAttached()).toBe(false);
    expect(consumer.snapshot()).toBeNull();
  });

  it('snapshot defends against malformed weights/volume on the node', async () => {
    const node = fakeNode();
    const consumer = createVrmAudioConsumer({
      profile: TEST_PROFILE,
      createNode: vi.fn(async () => node),
    });
    await consumer.attachAudioSource(fakeSource(), fakeAudioContext());
    // Inject NaN + missing keys; consumer must coerce to 0 / empty snapshot.
    node.weights = { A: Number.NaN, E: 0.2 } as Record<string, number>;
    node.volume = 0.5;
    const snap = consumer.snapshot();
    expect(snap?.weights.A).toBe(0);
    expect(snap?.weights.E).toBeCloseTo(0.2);
    expect(snap?.weights.I).toBe(0);
  });
});
