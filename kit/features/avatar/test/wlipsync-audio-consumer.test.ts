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
    disconnect: vi.fn(),
    port: { onmessage: null, close: vi.fn() },
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
  it('shares concurrent first creation and attaches only the latest source', async () => {
    let finish!: (node: WLipSyncAudioNode) => void;
    const createNode = vi.fn(() => new Promise<WLipSyncAudioNode>(resolve => { finish = resolve; }));
    const consumer = createWLipSyncAudioConsumer({ profile: TEST_PROFILE, createNode });
    const context = fakeAudioContext(), first = fakeSource(), second = fakeSource(), node = fakeNode();
    const one = consumer.attachAudioSource(first, context);
    const two = consumer.attachAudioSource(second, context);
    expect(createNode).toHaveBeenCalledOnce();
    finish(node);
    await Promise.all([one, two]);
    expect(first.connect).not.toHaveBeenCalled();
    expect(second.connect).toHaveBeenCalledExactlyOnceWith(node);
    consumer.detachAudioSource();
    expect(second.disconnect).toHaveBeenCalledExactlyOnceWith(node);
  });

  it('discards an old A/B/A context creation without replacing or disconnecting the current node', async () => {
    const resolvers: Array<(node: WLipSyncAudioNode) => void> = [];
    const consumer = createWLipSyncAudioConsumer({ profile: TEST_PROFILE,
      createNode: () => new Promise(resolve => { resolvers.push(resolve); }),
    });
    const contextA = fakeAudioContext(), contextB = fakeAudioContext();
    const first = fakeSource(), second = fakeSource(), current = fakeSource();
    const oldA = fakeNode(), oldB = fakeNode(), currentA = fakeNode();
    currentA.volume = 0.7;
    const one = consumer.attachAudioSource(first, contextA);
    const two = consumer.attachAudioSource(second, contextB);
    const three = consumer.attachAudioSource(current, contextA);
    resolvers[2]!(currentA); await three;
    resolvers[1]!(oldB); await two;
    resolvers[0]!(oldA); await one;
    expect(consumer.snapshot()?.volume).toBe(0.7);
    expect(first.connect).not.toHaveBeenCalled();
    expect(second.connect).not.toHaveBeenCalled();
    expect(oldA.disconnect).toHaveBeenCalledOnce();
    expect(oldA.port.close).toHaveBeenCalledOnce();
    expect(oldB.disconnect).toHaveBeenCalledOnce();
    expect(currentA.disconnect).not.toHaveBeenCalled();
    consumer.detachAudioSource();
    expect(current.disconnect).toHaveBeenCalledExactlyOnceWith(currentA);
  });

  it('does not silence a newer context when an obsolete creation fails', async () => {
    let rejectOld!: (error: Error) => void;
    const old = new Promise<WLipSyncAudioNode>((_, reject) => { rejectOld = reject; });
    const node = fakeNode(), onSilent = vi.fn();
    const createNode = vi.fn().mockReturnValueOnce(old).mockResolvedValueOnce(node);
    const consumer = createWLipSyncAudioConsumer({ profile: TEST_PROFILE, createNode, onSilent });
    const first = consumer.attachAudioSource(fakeSource(), fakeAudioContext());
    await consumer.attachAudioSource(fakeSource(), fakeAudioContext());
    rejectOld(new Error('obsolete context failed'));
    await first;
    expect(onSilent).not.toHaveBeenCalled();
    expect(consumer.isAttached()).toBe(true);
  });

  it('stays silent after pending attach is detached and can attach on a later request', async () => {
    let finish!: (node: WLipSyncAudioNode) => void;
    const node = fakeNode(), source = fakeSource(), context = fakeAudioContext();
    const createNode = vi.fn(() => new Promise<WLipSyncAudioNode>(resolve => { finish = resolve; }));
    const consumer = createWLipSyncAudioConsumer({ profile: TEST_PROFILE, createNode });
    const pending = consumer.attachAudioSource(source, context);
    consumer.silent();
    finish(node); await pending;
    expect(source.connect).not.toHaveBeenCalled();
    expect(consumer.snapshot()).toBeNull();
    const next = fakeSource();
    await consumer.attachAudioSource(next, context);
    expect(createNode).toHaveBeenCalledOnce();
    expect(next.connect).toHaveBeenCalledExactlyOnceWith(node);
  });

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

  it('detaches sources, hides stale weights, and reports attachment state', async () => {
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
    expect(consumer.snapshot()).toBeNull();
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
