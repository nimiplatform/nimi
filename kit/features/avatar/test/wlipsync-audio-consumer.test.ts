import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Profile } from 'wlipsync';
import {
  createWLipSyncAudioConsumer,
  type WLipSyncAudioNode,
} from '../src/wlipsync-audio-consumer.js';

function fakeNode(): WLipSyncAudioNode {
  return {
    weights: { A: 0, E: 0, I: 0, O: 0, U: 0, S: 0 },
    volume: 0,
  } as unknown as WLipSyncAudioNode;
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

describe('createWLipSyncAudioConsumer', () => {
  it('lazy-creates one node per AudioContext and exposes sanitized snapshots', async () => {
    const node = fakeNode();
    const createNode = vi.fn(async () => node);
    const consumer = createWLipSyncAudioConsumer({
      profile: TEST_PROFILE,
      createNode,
    });
    const context = fakeAudioContext();

    await consumer.attachAudioSource(fakeSource(), context);
    await consumer.attachAudioSource(fakeSource(), context);

    node.weights = { A: Number.NaN, E: 0.2, S: 0.5 } as Record<string, number>;
    node.volume = 0.7;

    expect(createNode).toHaveBeenCalledTimes(1);
    expect(consumer.snapshot()).toEqual({
      weights: { A: 0, E: 0.2, I: 0, O: 0, U: 0, S: 0.5 },
      volume: 0.7,
    });
  });

  it('recreates the node for a new AudioContext', async () => {
    const createNode = vi.fn(async () => fakeNode());
    const consumer = createWLipSyncAudioConsumer({
      profile: TEST_PROFILE,
      createNode,
    });

    await consumer.attachAudioSource(fakeSource(), fakeAudioContext());
    await consumer.attachAudioSource(fakeSource(), fakeAudioContext());

    expect(createNode).toHaveBeenCalledTimes(2);
  });

  it('detaches sources, preserves node snapshot, and reports attachment state', async () => {
    const node = fakeNode();
    const source = fakeSource();
    const consumer = createWLipSyncAudioConsumer({
      profile: TEST_PROFILE,
      createNode: vi.fn(async () => node),
    });

    await consumer.attachAudioSource(source, fakeAudioContext());
    expect(consumer.isAttached()).toBe(true);

    consumer.detachAudioSource();

    expect(consumer.isAttached()).toBe(false);
    expect(source.disconnect).toHaveBeenCalledWith(node);
    expect(consumer.snapshot()).not.toBeNull();
  });

  it('fails closed for missing profile and node creation errors', async () => {
    const onSilent = vi.fn();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const noProfile = createWLipSyncAudioConsumer({
      profile: null,
      createNode: vi.fn(async () => fakeNode()),
      onSilent,
      missingProfileMessage: 'missing-profile',
    });

    await noProfile.attachAudioSource(fakeSource(), fakeAudioContext());
    await noProfile.attachAudioSource(fakeSource(), fakeAudioContext());

    expect(warn).toHaveBeenCalledTimes(1);
    expect(onSilent).toHaveBeenCalledTimes(2);
    expect(noProfile.snapshot()).toBeNull();

    const createFailSilent = vi.fn();
    const createFail = createWLipSyncAudioConsumer({
      profile: TEST_PROFILE,
      createNode: vi.fn(async () => {
        throw new Error('worklet_load_failed');
      }),
      onSilent: createFailSilent,
      createFailureMessage: 'create-failed',
    });

    await createFail.attachAudioSource(fakeSource(), fakeAudioContext());

    expect(createFailSilent).toHaveBeenCalled();
    expect(createFail.isAttached()).toBe(false);
    expect(createFail.snapshot()).toBeNull();
  });
});
