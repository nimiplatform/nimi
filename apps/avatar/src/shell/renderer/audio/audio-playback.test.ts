import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AudioPlaybackController,
  SYNTHETIC_AUDIO_MIME_TYPE,
  type AudioPlaybackSnapshot,
} from './audio-playback.js';

type FakeBufferSource = {
  buffer: AudioBuffer | null;
  onended: (() => void) | null;
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  connect: ReturnType<typeof vi.fn>;
};

function createFakeContext(decode?: () => Promise<AudioBuffer>): {
  context: AudioContext;
  source: FakeBufferSource;
  decodeAudioData: ReturnType<typeof vi.fn>;
} {
  const source: FakeBufferSource = {
    buffer: null,
    onended: null,
    start: vi.fn(),
    stop: vi.fn(),
    connect: vi.fn(),
  };
  const decodeAudioData = vi.fn(decode ?? (async () => ({ duration: 1.2 } as AudioBuffer)));
  const context = {
    destination: {} as AudioDestinationNode,
    decodeAudioData,
    createBufferSource: () => source as unknown as AudioBufferSourceNode,
  } as unknown as AudioContext;
  return { context, source, decodeAudioData };
}

function bufferOf(size: number): ArrayBuffer {
  return new ArrayBuffer(size);
}

function recordSnapshots(controller: AudioPlaybackController): { snapshots: AudioPlaybackSnapshot[]; unsubscribe: () => void } {
  const snapshots: AudioPlaybackSnapshot[] = [];
  const unsubscribe = controller.subscribe((snap) => {
    snapshots.push(snap);
  });
  return { snapshots, unsubscribe };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('AudioPlaybackController — synthetic mime fail-close', () => {
  it('does not construct an AudioContext for synthetic mime and lands on completed', async () => {
    const audioContextFactory = vi.fn(() => null);
    const warn = vi.fn();
    const controller = new AudioPlaybackController({
      audioContextFactory,
      logger: { warn, error: vi.fn() },
    });
    const { snapshots } = recordSnapshots(controller);

    await controller.play({
      audioArtifactId: 'synthetic://lipsync/turn-1',
      audioMimeType: SYNTHETIC_AUDIO_MIME_TYPE,
    });

    expect(audioContextFactory).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toBe('synthetic_audio_no_playback');
    // Subscription delivers idle (initial) → requested → completed
    expect(snapshots.map((s) => s.state)).toEqual(['idle', 'requested', 'completed']);
    expect(snapshots[snapshots.length - 1]?.reason).toBe('synthetic_audio_no_playback');
  });
});

describe('AudioPlaybackController — real audio path', () => {
  it('decodes bytes, starts AudioBufferSourceNode, transitions to started → completed', async () => {
    const fake = createFakeContext();
    const controller = new AudioPlaybackController({
      audioContextFactory: () => fake.context,
      logger: { warn: vi.fn(), error: vi.fn() },
    });
    const { snapshots } = recordSnapshots(controller);

    await controller.play({
      audioArtifactId: 'artifact-1',
      audioMimeType: 'audio/wav',
      fetchBytes: async () => bufferOf(1024),
    });

    expect(fake.decodeAudioData).toHaveBeenCalledTimes(1);
    expect(fake.source.start).toHaveBeenCalledTimes(1);
    expect(snapshots.map((s) => s.state)).toEqual(['idle', 'requested', 'started']);

    // Simulate browser firing onended.
    fake.source.onended?.();
    expect(snapshots.map((s) => s.state)).toEqual(['idle', 'requested', 'started', 'completed']);
  });

  it('marks failed when fetchBytes is missing', async () => {
    const controller = new AudioPlaybackController({
      audioContextFactory: () => null,
      logger: { warn: vi.fn(), error: vi.fn() },
    });
    const { snapshots } = recordSnapshots(controller);
    await controller.play({ audioArtifactId: 'a', audioMimeType: 'audio/wav' });
    expect(snapshots.map((s) => s.state)).toEqual(['idle', 'requested', 'failed']);
    expect(snapshots[snapshots.length - 1]?.reason).toBe('audio_fetch_bytes_unavailable');
  });

  it('marks failed when decodeAudioData throws', async () => {
    const fake = createFakeContext(async () => {
      throw new Error('bad audio');
    });
    const controller = new AudioPlaybackController({
      audioContextFactory: () => fake.context,
      logger: { warn: vi.fn(), error: vi.fn() },
    });
    const { snapshots } = recordSnapshots(controller);
    await controller.play({
      audioArtifactId: 'a',
      audioMimeType: 'audio/wav',
      fetchBytes: async () => bufferOf(64),
    });
    expect(snapshots.map((s) => s.state)).toEqual(['idle', 'requested', 'failed']);
    expect(snapshots[snapshots.length - 1]?.reason).toBe('audio_decode_failed');
    expect(fake.source.start).not.toHaveBeenCalled();
  });

  it('rejects empty audio identity (fail-close)', async () => {
    const controller = new AudioPlaybackController({
      audioContextFactory: () => null,
      logger: { warn: vi.fn(), error: vi.fn() },
    });
    const { snapshots } = recordSnapshots(controller);
    await controller.play({ audioArtifactId: '   ', audioMimeType: 'audio/wav' });
    expect(snapshots.map((s) => s.state)).toEqual(['idle', 'failed']);
    expect(snapshots[snapshots.length - 1]?.reason).toBe('missing_audio_identity');
  });

  it('rejects non-audio mime when not synthetic (fail-close)', async () => {
    const controller = new AudioPlaybackController({
      audioContextFactory: () => null,
      logger: { warn: vi.fn(), error: vi.fn() },
    });
    const { snapshots } = recordSnapshots(controller);
    await controller.play({ audioArtifactId: 'a', audioMimeType: 'text/plain' });
    expect(snapshots.map((s) => s.state)).toEqual(['idle', 'requested', 'failed']);
    expect(snapshots[snapshots.length - 1]?.reason).toBe('unsupported_audio_mime_type');
  });
});

describe('AudioPlaybackController — interrupt + reset', () => {
  it('stop() interrupts an in-flight playback', async () => {
    const fake = createFakeContext();
    const controller = new AudioPlaybackController({
      audioContextFactory: () => fake.context,
      logger: { warn: vi.fn(), error: vi.fn() },
    });
    const { snapshots } = recordSnapshots(controller);

    await controller.play({
      audioArtifactId: 'a',
      audioMimeType: 'audio/wav',
      fetchBytes: async () => bufferOf(64),
    });
    controller.stop('interrupted');

    expect(fake.source.stop).toHaveBeenCalled();
    const tail = snapshots.map((s) => s.state);
    expect(tail).toContain('interrupted');
  });

  it('reset() returns to idle and clears source', () => {
    const fake = createFakeContext();
    const controller = new AudioPlaybackController({
      audioContextFactory: () => fake.context,
      logger: { warn: vi.fn(), error: vi.fn() },
    });
    controller.reset();
    expect(controller.getSnapshot().state).toBe('idle');
  });
});
