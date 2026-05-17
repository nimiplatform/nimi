// Wave 0 of topic 2026-04-30-avatar-vrm-backend-branch admit (design-05).
//
// AudioPipelineController test (renamed from AudioPlaybackController).
// Verifies hard-cut surface:
//   - Bytes are read via `runtime.artifacts.readBytes`; the caller-injected
//     byte fetcher no longer exists.
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
} from './audio-pipeline.js';
import type { BackendAudioConsumer } from '../carrier/backend-branch.js';

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

function createSinkMock(): BackendAudioConsumer & {
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

function createRuntimeMock(readBytes: (input: { artifactId: string; expectedMimePrefix?: string }) => Promise<unknown>) {
  const readBytesFn = vi.fn(readBytes);
  return {
    artifacts: { readBytes: readBytesFn },
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

describe('AudioPipelineController — runtime.artifacts.readBytes path', () => {
  it('decodes bytes from runtime, starts source, attaches sink, transitions to started → completed', async () => {
    const fake = createFakeContext();
    const runtime = createRuntimeMock(async () => ({
      bytes: bufferOf(1024),
      mimeType: 'audio/wav',
      sizeBytes: 1024,
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

    expect(runtime.artifacts.readBytes).toHaveBeenCalledWith({
      artifactId: 'artifact-1',
      expectedMimePrefix: 'audio/',
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

  it('propagates SDK reasonCode from runtime.artifacts.readBytes errors unchanged', async () => {
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
      bytes: bufferOf(128),
      mimeType: 'audio/wav',
      sizeBytes: 128,
    }));
    const controller = new AudioPipelineController({
      audioContextFactory: () => fake.context,
      logger: { warn: vi.fn(), error: vi.fn() },
    });
    controller.setRuntime(runtime as never);

    await controller.play({ audioArtifactId: 'a', audioMimeType: 'Audio/WAV' });

    expect(runtime.artifacts.readBytes).toHaveBeenCalledWith({
      artifactId: 'a',
      expectedMimePrefix: 'audio/',
    });
    expect(controller.getSnapshot().state).toBe('started');
  });

  it('marks failed when decodeAudioData throws', async () => {
    const fake = createFakeContext(async () => {
      throw new Error('bad audio');
    });
    const runtime = createRuntimeMock(async () => ({
      bytes: bufferOf(64),
      mimeType: 'audio/wav',
      sizeBytes: 64,
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
});

describe('AudioPipelineController — interrupt + reset', () => {
  it('stop() interrupts an in-flight playback and emits sink.silent()', async () => {
    const fake = createFakeContext();
    const runtime = createRuntimeMock(async () => ({
      bytes: bufferOf(64),
      mimeType: 'audio/wav',
      sizeBytes: 64,
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
