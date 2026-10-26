// Contract tests for .nimi/spec/avatar/embodiment-surface.authority.yaml.
//
// AudioPipelineController test (renamed from AudioPlaybackController).
// Verifies hard-cut surface:
//   - Bytes are read via `runtime.artifacts.readArtifactBytes`; the
//     caller-injected byte fetcher no longer exists.
//   - `registerLipsyncSink(consumer)` connects a BackendAudioConsumer; the
//     pipeline calls `attachAudioSource` after `source.start()` and `silent`
//     on synthetic / fail / stop / reset.
//   - Synthetic mime path lands on `completed` and emits `silent()`.
//   - SDK errors with `reasonCode` propagate unchanged as failed.reason.

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AudioPipelineController,
  SYNTHETIC_AUDIO_MIME_TYPE,
  type AudioPlaybackSnapshot,
  type AvatarAudioPipelineSink,
} from '../src/audio-pipeline.js';

type FakeBufferSource = {
  buffer: AudioBuffer | null;
  onended: (() => void) | null;
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  connect: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
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
    disconnect: vi.fn(),
  };
  const decodeAudioData = vi.fn(decode ?? (async () => ({ duration: 1.2 } as AudioBuffer)));
  const context = {
    destination: {} as AudioDestinationNode,
    decodeAudioData,
    createBufferSource: () => source as unknown as AudioBufferSourceNode,
  } as unknown as AudioContext;
  return { context, source, decodeAudioData };
}

function bytesOf(size: number): Uint8Array {
  return new Uint8Array(size);
}

function recordSnapshots(controller: AudioPipelineController): {
  snapshots: AudioPlaybackSnapshot[];
  unsubscribe: () => void;
} {
  const snapshots: AudioPlaybackSnapshot[] = [];
  const unsubscribe = controller.subscribe((snap) => {
    snapshots.push(snap);
  });
  return { snapshots, unsubscribe };
}

function createSinkMock(): AvatarAudioPipelineSink & {
  attachAudioSource: ReturnType<typeof vi.fn>;
  detachAudioSource: ReturnType<typeof vi.fn>;
  silent: ReturnType<typeof vi.fn>;
  snapshot: ReturnType<typeof vi.fn>;
} {
  return {
    attachAudioSource: vi.fn(async () => undefined),
    detachAudioSource: vi.fn(),
    silent: vi.fn(),
    snapshot: vi.fn(() => null),
  } as never;
}

function createRuntimeMock(readArtifactBytes: (input: { artifactId: string }) => Promise<unknown>) {
  const readArtifactBytesFn = vi.fn(readArtifactBytes);
  return {
    artifacts: { readArtifactBytes: readArtifactBytesFn },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('AudioPipelineController — synthetic mime fail-close', () => {
  it('does not construct an AudioContext for synthetic mime, lands on completed, calls sink.silent()', async () => {
    const audioContextFactory = vi.fn(() => null);
    const warn = vi.fn();
    const sink = createSinkMock();
    const controller = new AudioPipelineController({
      audioContextFactory,
      logger: { warn, error: vi.fn() },
    });
    controller.registerLipsyncSink(sink);
    const { snapshots } = recordSnapshots(controller);

    await controller.play({
      audioArtifactId: 'synthetic://lipsync/turn-1',
      audioMimeType: SYNTHETIC_AUDIO_MIME_TYPE,
    });

    expect(audioContextFactory).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      'synthetic_audio_no_playback_no_lipsync',
      expect.objectContaining({
        audio_artifact_id: 'synthetic://lipsync/turn-1',
        audio_mime_type: SYNTHETIC_AUDIO_MIME_TYPE,
      }),
    );
    expect(sink.silent).toHaveBeenCalledTimes(1);
    expect(sink.attachAudioSource).not.toHaveBeenCalled();
    expect(snapshots.map((s) => s.state)).toEqual(['idle', 'requested', 'completed']);
    expect(snapshots[snapshots.length - 1]?.reason).toBe('synthetic_audio_no_playback');
  });
});

describe('AudioPipelineController — runtime.artifacts.readArtifactBytes path', () => {
  it('decodes transient stream bytes without reading durable artifacts', async () => {
    const fake = createFakeContext();
    const runtime = createRuntimeMock(async () => {
      throw new Error('durable artifact read must not be used for transient voice chunks');
    });
    const sink = createSinkMock();
    const controller = new AudioPipelineController({
      audioContextFactory: () => fake.context,
      logger: { warn: vi.fn(), error: vi.fn() },
    });
    controller.setRuntime(runtime as never);
    controller.registerLipsyncSink(sink);
    const { snapshots } = recordSnapshots(controller);

    await controller.playBytes({
      audioSourceId: 'avatar-conversation-voice://voice-stream-1/chunks/000001',
      audioMimeType: 'audio/wav',
      bytes: bytesOf(256),
    });

    expect(runtime.artifacts.readArtifactBytes).not.toHaveBeenCalled();
    expect(fake.decodeAudioData).toHaveBeenCalledTimes(1);
    expect(fake.source.start).toHaveBeenCalledTimes(1);
    expect(snapshots.map((s) => s.state)).toEqual(['idle', 'requested', 'started']);
    await Promise.resolve();
    expect(sink.attachAudioSource).toHaveBeenCalledTimes(1);
  });

  it('decodes bytes from runtime, starts source, attaches sink, transitions to started → completed', async () => {
    const fake = createFakeContext();
    const runtime = createRuntimeMock(async () => ({
      bytes: bytesOf(1024),
      mimeType: 'audio/wav',
      sizeBytes: '1024',
      mimeInferred: false,
    }));
    const sink = createSinkMock();
    const controller = new AudioPipelineController({
      audioContextFactory: () => fake.context,
      logger: { warn: vi.fn(), error: vi.fn() },
    });
    controller.setRuntime(runtime as never);
    controller.registerLipsyncSink(sink);
    const { snapshots } = recordSnapshots(controller);

    await controller.play({
      audioArtifactId: 'artifact-1',
      audioMimeType: 'audio/wav',
    });

    expect(runtime.artifacts.readArtifactBytes).toHaveBeenCalledWith({
      artifactId: 'artifact-1',
    });
    expect(fake.decodeAudioData).toHaveBeenCalledTimes(1);
    expect(fake.source.start).toHaveBeenCalledTimes(1);
    expect(snapshots.map((s) => s.state)).toEqual(['idle', 'requested', 'started']);

    // Microtask boundary so the post-start sink attach runs.
    await Promise.resolve();
    expect(sink.attachAudioSource).toHaveBeenCalledTimes(1);

    fake.source.onended?.();
    expect(snapshots.map((s) => s.state)).toEqual(['idle', 'requested', 'started', 'completed']);
    expect(sink.detachAudioSource).toHaveBeenCalled();
  });

  it('keeps audio playing but exposes lipsync-silent when sink attachment fails', async () => {
    const fake = createFakeContext();
    const runtime = createRuntimeMock(async () => ({
      bytes: bytesOf(1024),
      mimeType: 'audio/wav',
      sizeBytes: '1024',
      mimeInferred: false,
    }));
    const sink = createSinkMock();
    sink.attachAudioSource.mockRejectedValueOnce(new Error('worklet unavailable'));
    const controller = new AudioPipelineController({
      audioContextFactory: () => fake.context,
      logger: { warn: vi.fn(), error: vi.fn() },
    });
    controller.setRuntime(runtime as never);
    controller.registerLipsyncSink(sink);
    const { snapshots } = recordSnapshots(controller);

    await controller.play({ audioArtifactId: 'artifact-1', audioMimeType: 'audio/wav' });
    await Promise.resolve();
    await Promise.resolve();

    expect(fake.source.stop).not.toHaveBeenCalled();
    expect(sink.silent).toHaveBeenCalledTimes(1);
    expect(controller.getSnapshot()).toMatchObject({
      state: 'started',
      reason: 'lipsync_sink_failed',
    });
    fake.source.onended?.();
    expect(snapshots.at(-1)).toMatchObject({ state: 'completed', reason: null });
  });

  it('fails closed with `no_runtime` when setRuntime was never called', async () => {
    const sink = createSinkMock();
    const controller = new AudioPipelineController({
      audioContextFactory: () => null,
      logger: { warn: vi.fn(), error: vi.fn() },
    });
    controller.registerLipsyncSink(sink);
    const { snapshots } = recordSnapshots(controller);

    await controller.play({ audioArtifactId: 'a', audioMimeType: 'audio/wav' });

    expect(snapshots.map((s) => s.state)).toEqual(['idle', 'requested', 'failed']);
    expect(snapshots[snapshots.length - 1]?.reason).toBe('no_runtime');
    expect(sink.silent).toHaveBeenCalled();
  });

  it('propagates SDK reasonCode from runtime.artifacts.readArtifactBytes errors unchanged', async () => {
    const runtime = createRuntimeMock(async () => {
      const err = new Error('artifact missing') as Error & { reasonCode?: string };
      err.reasonCode = 'ARTIFACT_NOT_FOUND';
      throw err;
    });
    const fake = createFakeContext();
    const sink = createSinkMock();
    const controller = new AudioPipelineController({
      audioContextFactory: () => fake.context,
      logger: { warn: vi.fn(), error: vi.fn() },
    });
    controller.setRuntime(runtime as never);
    controller.registerLipsyncSink(sink);
    const { snapshots } = recordSnapshots(controller);

    await controller.play({ audioArtifactId: 'a', audioMimeType: 'audio/wav' });

    expect(snapshots.map((s) => s.state)).toEqual(['idle', 'requested', 'failed']);
    expect(snapshots[snapshots.length - 1]?.reason).toBe('ARTIFACT_NOT_FOUND');
    expect(sink.silent).toHaveBeenCalled();
  });

  it('accepts audio MIME prefixes case-insensitively', async () => {
    const fake = createFakeContext();
    const runtime = createRuntimeMock(async () => ({
      bytes: bytesOf(128),
      mimeType: 'audio/wav',
      sizeBytes: '128',
      mimeInferred: false,
    }));
    const controller = new AudioPipelineController({
      audioContextFactory: () => fake.context,
      logger: { warn: vi.fn(), error: vi.fn() },
    });
    controller.setRuntime(runtime as never);

    await controller.play({ audioArtifactId: 'a', audioMimeType: 'Audio/WAV' });

    expect(runtime.artifacts.readArtifactBytes).toHaveBeenCalledWith({
      artifactId: 'a',
    });
    expect(controller.getSnapshot().state).toBe('started');
  });

  it('fails closed when runtime returns non-audio artifact bytes', async () => {
    const fake = createFakeContext();
    const runtime = createRuntimeMock(async () => ({
      bytes: bytesOf(32),
      mimeType: 'application/octet-stream',
      sizeBytes: '32',
      mimeInferred: true,
    }));
    const sink = createSinkMock();
    const controller = new AudioPipelineController({
      audioContextFactory: () => fake.context,
      logger: { warn: vi.fn(), error: vi.fn() },
    });
    controller.setRuntime(runtime as never);
    controller.registerLipsyncSink(sink);
    const { snapshots } = recordSnapshots(controller);

    await controller.play({ audioArtifactId: 'a', audioMimeType: 'audio/wav' });

    expect(snapshots.map((s) => s.state)).toEqual(['idle', 'requested', 'failed']);
    expect(snapshots[snapshots.length - 1]?.reason).toBe('ARTIFACT_MIME_MISMATCH');
    expect(fake.decodeAudioData).not.toHaveBeenCalled();
    expect(sink.silent).toHaveBeenCalled();
  });

  it('marks failed when decodeAudioData throws', async () => {
    const fake = createFakeContext(async () => {
      throw new Error('bad audio');
    });
    const runtime = createRuntimeMock(async () => ({
      bytes: bytesOf(64),
      mimeType: 'audio/wav',
      sizeBytes: '64',
      mimeInferred: false,
    }));
    const sink = createSinkMock();
    const controller = new AudioPipelineController({
      audioContextFactory: () => fake.context,
      logger: { warn: vi.fn(), error: vi.fn() },
    });
    controller.setRuntime(runtime as never);
    controller.registerLipsyncSink(sink);
    const { snapshots } = recordSnapshots(controller);

    await controller.play({ audioArtifactId: 'a', audioMimeType: 'audio/wav' });

    expect(snapshots.map((s) => s.state)).toEqual(['idle', 'requested', 'failed']);
    expect(snapshots[snapshots.length - 1]?.reason).toBe('decode_failed');
    expect(fake.source.start).not.toHaveBeenCalled();
    expect(sink.silent).toHaveBeenCalled();
  });

  it('rejects empty audio identity (fail-close) — sink.silent before requested', async () => {
    const sink = createSinkMock();
    const controller = new AudioPipelineController({
      audioContextFactory: () => null,
      logger: { warn: vi.fn(), error: vi.fn() },
    });
    controller.registerLipsyncSink(sink);
    const { snapshots } = recordSnapshots(controller);
    await controller.play({ audioArtifactId: '   ', audioMimeType: 'audio/wav' });
    expect(snapshots.map((s) => s.state)).toEqual(['idle', 'failed']);
    expect(snapshots[snapshots.length - 1]?.reason).toBe('missing_audio_identity');
    expect(sink.silent).toHaveBeenCalled();
  });

  it('rejects non-audio mime when not synthetic (fail-close)', async () => {
    const sink = createSinkMock();
    const controller = new AudioPipelineController({
      audioContextFactory: () => null,
      logger: { warn: vi.fn(), error: vi.fn() },
    });
    controller.registerLipsyncSink(sink);
    const { snapshots } = recordSnapshots(controller);
    await controller.play({ audioArtifactId: 'a', audioMimeType: 'text/plain' });
    expect(snapshots.map((s) => s.state)).toEqual(['idle', 'requested', 'failed']);
    expect(snapshots[snapshots.length - 1]?.reason).toBe('unsupported_mime');
    expect(sink.silent).toHaveBeenCalled();
  });
});

describe('AudioPipelineController — sink registration', () => {
  it('detaches the previous sink when a new one registers (single-sink invariant)', () => {
    const controller = new AudioPipelineController({
      audioContextFactory: () => null,
      logger: { warn: vi.fn(), error: vi.fn() },
    });
    const first = createSinkMock();
    const second = createSinkMock();
    controller.registerLipsyncSink(first);
    controller.registerLipsyncSink(second);
    expect(first.detachAudioSource).toHaveBeenCalledTimes(1);
  });

  it('returns an unregister fn that clears the active sink slot', () => {
    const controller = new AudioPipelineController({
      audioContextFactory: () => null,
      logger: { warn: vi.fn(), error: vi.fn() },
    });
    const sink = createSinkMock();
    const unregister = controller.registerLipsyncSink(sink);
    unregister();
    expect(sink.detachAudioSource).toHaveBeenCalledTimes(1);
    // Subsequent unregister is a no-op (sink slot already cleared).
    unregister();
    expect(sink.detachAudioSource).toHaveBeenCalledTimes(1);
  });

  it('exposes lipsync-silent if a late-registered sink cannot attach to active audio', async () => {
    const fake = createFakeContext();
    const controller = new AudioPipelineController({
      audioContextFactory: () => fake.context,
      logger: { warn: vi.fn(), error: vi.fn() },
    });
    await controller.playBytes({
      audioSourceId: 'avatar-conversation-voice://stream/chunks/1',
      audioMimeType: 'audio/wav',
      bytes: bytesOf(32),
    });
    const sink = createSinkMock();
    sink.attachAudioSource.mockRejectedValueOnce(new Error('backend unavailable'));

    controller.registerLipsyncSink(sink);
    await Promise.resolve();
    await Promise.resolve();

    expect(sink.silent).toHaveBeenCalledTimes(1);
    expect(controller.getSnapshot()).toMatchObject({
      state: 'started',
      reason: 'lipsync_sink_failed',
    });
  });
});

describe('AudioPipelineController — interrupt + reset', () => {
  it.each(['play', 'playBytes'] as const)('settles a superseded pending %s request before publishing its replacement', async (method) => {
    let finishDecode!: (buffer: AudioBuffer) => void;
    const firstDecode = new Promise<AudioBuffer>(resolve => { finishDecode = resolve; });
    const fake = createFakeContext();
    fake.decodeAudioData.mockReturnValueOnce(firstDecode);
    const controller = new AudioPipelineController({ audioContextFactory: () => fake.context });
    controller.setRuntime(createRuntimeMock(async () => ({ bytes: bytesOf(8), mimeType: 'audio/wav' })) as never);
    const { snapshots } = recordSnapshots(controller);
    const start = (id: string) => method === 'play'
      ? controller.play({ audioArtifactId: id, audioMimeType: 'audio/wav' })
      : controller.playBytes({ audioSourceId: id, audioMimeType: 'audio/wav', bytes: bytesOf(8) });
    const first = start('same-id');
    await vi.waitFor(() => expect(fake.decodeAudioData).toHaveBeenCalledOnce());
    await start('same-id');
    expect(snapshots.map(snapshot => snapshot.state)).toEqual(['idle', 'requested', 'interrupted', 'requested', 'started']);
    finishDecode({ duration: 1 } as AudioBuffer);
    await first;
    expect(fake.source.start).toHaveBeenCalledOnce();
    controller.stop();
  });

  it('reset settles pending playback before clearing its identity', async () => {
    let finishDecode!: (buffer: AudioBuffer) => void;
    const fake = createFakeContext(() => new Promise(resolve => { finishDecode = resolve; }));
    const controller = new AudioPipelineController({ audioContextFactory: () => fake.context });
    const { snapshots } = recordSnapshots(controller);
    const pending = controller.playBytes({ audioSourceId: 'pending', audioMimeType: 'audio/wav', bytes: bytesOf(8) });
    controller.reset();
    expect(snapshots.slice(-2)).toMatchObject([
      { state: 'interrupted', audioArtifactId: 'pending' },
      { state: 'idle', audioArtifactId: null },
    ]);
    finishDecode({ duration: 1 } as AudioBuffer);
    await pending;
    expect(fake.source.start).not.toHaveBeenCalled();
  });

  it.each(['start', 'register'] as const)('ignores a stale %s sink failure after another playback owns the sink', async (attachment) => {
    let failAttach!: (error: Error) => void;
    const pendingAttach = new Promise<void>((_, reject) => { failAttach = reject; });
    const fake = createFakeContext();
    const controller = new AudioPipelineController({ audioContextFactory: () => fake.context, logger: { warn: vi.fn(), error: vi.fn() } });
    const sink = createSinkMock();
    sink.attachAudioSource.mockReturnValueOnce(pendingAttach);
    if (attachment === 'start') controller.registerLipsyncSink(sink);
    await controller.playBytes({ audioSourceId: 'first', audioMimeType: 'audio/wav', bytes: bytesOf(8) });
    if (attachment === 'register') controller.registerLipsyncSink(sink);
    await controller.playBytes({ audioSourceId: 'second', audioMimeType: 'audio/wav', bytes: bytesOf(8) });
    const silenceCalls = sink.silent.mock.calls.length;
    failAttach(new Error('retired attach failed'));
    await Promise.resolve();
    await Promise.resolve();
    expect(sink.silent).toHaveBeenCalledTimes(silenceCalls);
    expect(controller.getSnapshot()).toMatchObject({ state: 'started', audioArtifactId: 'second', reason: null });
    controller.stop();
  });

  it('disconnects the speaker source on completion and cancellation', async () => {
    const fake = createFakeContext();
    const controller = new AudioPipelineController({ audioContextFactory: () => fake.context });
    await controller.playBytes({ audioSourceId: 'ended', audioMimeType: 'audio/wav', bytes: bytesOf(8) });
    fake.source.onended?.();
    expect(fake.source.disconnect).toHaveBeenCalledOnce();
    await controller.playBytes({ audioSourceId: 'stopped', audioMimeType: 'audio/wav', bytes: bytesOf(8) });
    controller.stop();
    expect(fake.source.disconnect).toHaveBeenCalledTimes(2);
  });

  it('stop() interrupts an in-flight playback and emits sink.silent()', async () => {
    const fake = createFakeContext();
    const runtime = createRuntimeMock(async () => ({
      bytes: bytesOf(64),
      mimeType: 'audio/wav',
      sizeBytes: '64',
      mimeInferred: false,
    }));
    const sink = createSinkMock();
    const controller = new AudioPipelineController({
      audioContextFactory: () => fake.context,
      logger: { warn: vi.fn(), error: vi.fn() },
    });
    controller.setRuntime(runtime as never);
    controller.registerLipsyncSink(sink);
    const { snapshots } = recordSnapshots(controller);

    await controller.play({ audioArtifactId: 'a', audioMimeType: 'audio/wav' });
    controller.stop('interrupted');

    expect(fake.source.stop).toHaveBeenCalled();
    expect(snapshots.map((s) => s.state)).toContain('interrupted');
    expect(sink.silent).toHaveBeenCalled();
  });

  it('reset() returns to idle, clears source, calls sink.silent()', () => {
    const fake = createFakeContext();
    const sink = createSinkMock();
    const controller = new AudioPipelineController({
      audioContextFactory: () => fake.context,
      logger: { warn: vi.fn(), error: vi.fn() },
    });
    controller.registerLipsyncSink(sink);
    controller.reset();
    expect(controller.getSnapshot().state).toBe('idle');
    expect(sink.silent).toHaveBeenCalled();
  });
});
