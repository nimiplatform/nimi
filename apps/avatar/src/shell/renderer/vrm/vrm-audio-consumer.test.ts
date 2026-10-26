// Contract tests for .nimi/spec/avatar/embodiment-surface.authority.yaml.
//
// Verifies the VRM BackendAudioConsumer (vrm-audio-consumer.ts). Mirrors
// the live2d audio consumer test patterns: stub `createWLipSyncNode` via
// the test seam, verify lazy creation + per-AudioContext caching +
// detach/silent semantics + no-profile fallback path + create-failure
// fail-close.

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Profile } from 'wlipsync';
import { createVrmAudioConsumer } from './vrm-audio-consumer.js';

/** Supplies the worklet state and teardown surface consumed by the owner.
 *  The real worklet updates weights/volume from its message port. */
function fakeNode(): AudioWorkletNode & {
  weights: Record<string, number>;
  volume: number;
} {
  return {
    weights: { A: 0, E: 0, I: 0, O: 0, U: 0, S: 0 },
    volume: 0,
    disconnect: vi.fn(),
    port: { onmessage: vi.fn(), close: vi.fn() },
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
    const previous = fakeNode();
    const current = fakeNode();
    const create = vi.fn().mockResolvedValueOnce(previous).mockResolvedValueOnce(current);
    const consumer = createVrmAudioConsumer({
      profile: TEST_PROFILE,
      createNode: create,
    });
    const previousSource = fakeSource();
    const currentSource = fakeSource();
    await consumer.attachAudioSource(previousSource, fakeAudioContext());
    await consumer.attachAudioSource(currentSource, fakeAudioContext());
    expect(create).toHaveBeenCalledTimes(2);
    expect(previousSource.disconnect).toHaveBeenCalledExactlyOnceWith(previous);
    expect(previous.disconnect).toHaveBeenCalledOnce();
    expect(previous.port.onmessage).toBeNull();
    expect(previous.port.close).toHaveBeenCalledOnce();
    expect(currentSource.connect).toHaveBeenCalledExactlyOnceWith(current);
    expect(currentSource.disconnect).not.toHaveBeenCalled();
    expect(current.disconnect).not.toHaveBeenCalled();
    expect(current.port.close).not.toHaveBeenCalled();
  });

  it('detachAudioSource disconnects source, hides stale weights, and preserves the node for reuse', async () => {
    const node = fakeNode();
    const consumer = createVrmAudioConsumer({
      profile: TEST_PROFILE,
      createNode: vi.fn(async () => node),
    });
    const context = fakeAudioContext();
    const source = fakeSource();
    await consumer.attachAudioSource(source, context);
    expect(consumer.isAttached()).toBe(true);
    consumer.detachAudioSource();
    expect(consumer.isAttached()).toBe(false);
    expect(source.disconnect).toHaveBeenCalledWith(node);
    expect(consumer.snapshot()).toBeNull();

    const nextSource = fakeSource();
    await consumer.attachAudioSource(nextSource, context);
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

  it('does not reconnect a source when silence interrupts pending node creation', async () => {
    const node = fakeNode();
    let resolveNode!: (value: ReturnType<typeof fakeNode>) => void;
    const consumer = createVrmAudioConsumer({
      profile: TEST_PROFILE,
      createNode: vi.fn(
        () => new Promise<ReturnType<typeof fakeNode>>((resolve) => {
          resolveNode = resolve;
        }),
      ),
    });
    const source = fakeSource();

    const attaching = consumer.attachAudioSource(source, fakeAudioContext());
    consumer.silent();
    expect(resolveNode).toBeTypeOf('function');
    resolveNode(node);
    await attaching;

    expect(source.connect).not.toHaveBeenCalled();
    expect(consumer.isAttached()).toBe(false);
    expect(consumer.snapshot()).toBeNull();
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
