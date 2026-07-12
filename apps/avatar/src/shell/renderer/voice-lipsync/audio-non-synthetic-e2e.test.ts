// Deterministic non-synthetic audio contract test for
// .nimi/spec/avatar/kernel/backend-branch-contract.md.
//
// Why this file exists:
//   lipsync-e2e.test.ts proves the orchestrator + state-bus + sink loop. This
//   file adds deterministic RIFF/WAVE coverage without claiming live Runtime
//   daemon acceptance from a renderer-level test.
//
//   The test covers the contract deterministically without daemon startup by:
//     1. Constructing a real RIFF/WAVE byte sequence (not a synthetic mime,
//        not a zero buffer with a fabricated header).
//     2. Driving the byte sequence through the SAME public surface that the
//        runtime daemon would exercise:
//
//          runtime.artifacts.readArtifactBytes
//            → AudioPipelineController.play
//              → AudioContext.decodeAudioData
//                → source.start
//                → BackendAudioConsumer.attachAudioSource
//                → state transitions requested → started → completed
//
//   The mock boundary is exactly two seams:
//     - `runtime.artifacts.readArtifactBytes` returns the constructed bytes (the
//       runtime daemon would return the same shape; the SDK contract is
//       S-RUNTIME-111 `{bytes, mimeType, sizeBytes}`).
//     - `AudioContext.decodeAudioData` returns a stub `AudioBuffer` because
//       jsdom has no audio decoder. The bytes are real, the call is real,
//       only the platform decoder is mocked.
//
// Mock boundaries (what is NOT mocked):
//   - AudioPipelineController itself (real class, real state machine)
//   - mime gate (`audio/wav` is non-synthetic — exercises the decode branch,
//     not the synthetic short-circuit)
//   - reasonCode propagation
//   - sink.attachAudioSource / sink.silent ordering relative to source.start
//   - state machine transitions across the full happy path + 2 fail-close
//     branches (artifact_not_found, decode_failed)
//
// This is renderer-level contract coverage only. Live Runtime/App acceptance
// remains an independent required verification surface.

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AudioPipelineController,
  type AudioPlaybackSnapshot,
} from '@nimiplatform/kit/features/avatar/headless';
import type { BackendAudioConsumer } from '../carrier/backend-branch.js';

/**
 * Build a real RIFF/WAVE byte sequence: 44-byte header + 100ms of silence at
 * 48 kHz mono 16-bit (= 9600 samples = 19200 payload bytes).
 *
 * The bytes follow the canonical WAV layout:
 *   - "RIFF" + chunk size + "WAVE"
 *   - "fmt " sub-chunk: PCM, mono, 48000 Hz, 16-bit
 *   - "data" sub-chunk: 19200 zero bytes
 *
 * decodeAudioData is mocked in the tests, so byte-level correctness is not
 * required for the platform decoder to accept it. The proof point of this
 * file is: the bytes are NOT synthetic-mime-flagged and NOT a zero-length
 * buffer; the controller MUST take the decode path, not the short-circuit.
 */
function makeFakeWavBytes(): ArrayBuffer {
  const SAMPLE_RATE = 48_000;
  const CHANNELS = 1;
  const BITS_PER_SAMPLE = 16;
  const DURATION_MS = 100;
  const numSamples = Math.floor((SAMPLE_RATE * DURATION_MS) / 1000); // 4800
  const dataBytes = numSamples * CHANNELS * (BITS_PER_SAMPLE / 8); // 9600
  const totalBytes = 44 + dataBytes;
  const buffer = new ArrayBuffer(totalBytes);
  const view = new DataView(buffer);
  const u8 = new Uint8Array(buffer);

  // "RIFF" magic
  u8[0] = 0x52;
  u8[1] = 0x49;
  u8[2] = 0x46;
  u8[3] = 0x46;
  // chunk size (file size - 8)
  view.setUint32(4, totalBytes - 8, true);
  // "WAVE"
  u8[8] = 0x57;
  u8[9] = 0x41;
  u8[10] = 0x56;
  u8[11] = 0x45;
  // "fmt "
  u8[12] = 0x66;
  u8[13] = 0x6d;
  u8[14] = 0x74;
  u8[15] = 0x20;
  // fmt sub-chunk size (16 for PCM)
  view.setUint32(16, 16, true);
  // audio format (1 = PCM)
  view.setUint16(20, 1, true);
  // num channels
  view.setUint16(22, CHANNELS, true);
  // sample rate
  view.setUint32(24, SAMPLE_RATE, true);
  // byte rate = sample_rate * channels * bits/8
  view.setUint32(28, SAMPLE_RATE * CHANNELS * (BITS_PER_SAMPLE / 8), true);
  // block align = channels * bits/8
  view.setUint16(32, CHANNELS * (BITS_PER_SAMPLE / 8), true);
  // bits per sample
  view.setUint16(34, BITS_PER_SAMPLE, true);
  // "data"
  u8[36] = 0x64;
  u8[37] = 0x61;
  u8[38] = 0x74;
  u8[39] = 0x61;
  // data sub-chunk size
  view.setUint32(40, dataBytes, true);
  // payload = 9600 zero bytes (silence) — already initialized to 0

  return buffer;
}

type FakeBufferSource = {
  buffer: AudioBuffer | null;
  onended: (() => void) | null;
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  connect: ReturnType<typeof vi.fn>;
};

function createFakeAudioContext(decode?: () => Promise<AudioBuffer>): {
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
  const decodeAudioData = vi.fn(decode ?? (async () => ({ duration: 0.1 } as AudioBuffer)));
  const context = {
    destination: {} as AudioDestinationNode,
    decodeAudioData,
    createBufferSource: () => source as unknown as AudioBufferSourceNode,
  } as unknown as AudioContext;
  return { context, source, decodeAudioData };
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

function recordSnapshots(controller: AudioPipelineController): {
  snapshots: AudioPlaybackSnapshot[];
} {
  const snapshots: AudioPlaybackSnapshot[] = [];
  controller.subscribe((snap) => {
    snapshots.push(snap);
  });
  return { snapshots };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Audio non-synthetic contract path', () => {
  it('happy path: real .wav bytes flow runtime.artifacts.readArtifactBytes → decodeAudioData → source.start → sink.attachAudioSource → started → completed', async () => {
    const fakeWav = makeFakeWavBytes();
    expect(fakeWav.byteLength).toBe(44 + 9600);
    // Bytes start with the literal ASCII "RIFF" magic — proof this is NOT
    // a synthetic-mime path and NOT a placeholder zero buffer.
    const head = new Uint8Array(fakeWav.slice(0, 4));
    expect(Array.from(head)).toEqual([0x52, 0x49, 0x46, 0x46]);

    const readArtifactBytesSpy = vi.fn(async (input: { artifactId: string }) => {
      expect(input.artifactId).toBe('artifact-real-001');
      return {
        bytes: fakeWav,
        mimeType: 'audio/wav',
        sizeBytes: fakeWav.byteLength,
      };
    });
    const mockRuntime = {
      artifacts: { readArtifactBytes: readArtifactBytesSpy },
    };

    const fake = createFakeAudioContext();
    const sink = createSinkMock();
    const controller = new AudioPipelineController({
      audioContextFactory: () => fake.context,
      logger: { warn: vi.fn(), error: vi.fn() },
    });
    controller.setRuntime(mockRuntime as never);
    controller.registerLipsyncSink(sink);
    const { snapshots } = recordSnapshots(controller);

    await controller.play({
      audioArtifactId: 'artifact-real-001',
      // NON-SYNTHETIC mime — this is the #15 proof point.
      audioMimeType: 'audio/wav',
    });
    // Microtask flush so the post-start sink attach runs.
    await Promise.resolve();
    await Promise.resolve();

    // 1. readArtifactBytes called exactly once with the right input
    expect(readArtifactBytesSpy).toHaveBeenCalledTimes(1);
    expect(readArtifactBytesSpy).toHaveBeenCalledWith({
      artifactId: 'artifact-real-001',
    });
    // 2. AudioContext.decodeAudioData was called exactly once with a copy of
    //    the bytes (controller calls .slice(0) before decode).
    expect(fake.decodeAudioData).toHaveBeenCalledTimes(1);
    const decodedArg = fake.decodeAudioData.mock.calls[0]?.[0] as ArrayBuffer;
    expect(decodedArg).toBeInstanceOf(ArrayBuffer);
    expect(decodedArg.byteLength).toBe(fakeWav.byteLength);
    // 3. source.start called exactly once
    expect(fake.source.start).toHaveBeenCalledTimes(1);
    // 4. sink.attachAudioSource called once with the source + ctx
    expect(sink.attachAudioSource).toHaveBeenCalledTimes(1);
    expect(sink.attachAudioSource).toHaveBeenCalledWith(fake.source, fake.context);
    // 5. snapshot reached 'started'
    expect(controller.getSnapshot().state).toBe('started');
    // 6. sink.silent NOT called on happy path before playback ends
    expect(sink.silent).not.toHaveBeenCalled();
    // 7. state transition order
    expect(snapshots.map((s) => s.state)).toEqual(['idle', 'requested', 'started']);

    // Simulate browser onended → completed.
    fake.source.onended?.();
    expect(controller.getSnapshot().state).toBe('completed');
    expect(sink.detachAudioSource).toHaveBeenCalled();
  });

  it('readArtifactBytes throws ARTIFACT_NOT_FOUND → sink.silent, state failed (artifact_not_found), decodeAudioData NOT called', async () => {
    const readArtifactBytesSpy = vi.fn(async () => {
      const err = new Error('artifact missing') as Error & { reasonCode?: string };
      err.reasonCode = 'ARTIFACT_NOT_FOUND';
      throw err;
    });
    const mockRuntime = { artifacts: { readArtifactBytes: readArtifactBytesSpy } };
    const fake = createFakeAudioContext();
    const sink = createSinkMock();
    const controller = new AudioPipelineController({
      audioContextFactory: () => fake.context,
      logger: { warn: vi.fn(), error: vi.fn() },
    });
    controller.setRuntime(mockRuntime as never);
    controller.registerLipsyncSink(sink);
    const { snapshots } = recordSnapshots(controller);

    await controller.play({
      audioArtifactId: 'artifact-missing',
      audioMimeType: 'audio/wav',
    });

    expect(readArtifactBytesSpy).toHaveBeenCalledTimes(1);
    // Decode never reached.
    expect(fake.decodeAudioData).not.toHaveBeenCalled();
    expect(fake.source.start).not.toHaveBeenCalled();
    expect(sink.attachAudioSource).not.toHaveBeenCalled();
    // Sink silenced and state machine fail-closed with the SDK reasonCode.
    expect(sink.silent).toHaveBeenCalledTimes(1);
    expect(snapshots.map((s) => s.state)).toEqual(['idle', 'requested', 'failed']);
    expect(snapshots[snapshots.length - 1]?.reason).toBe('ARTIFACT_NOT_FOUND');
  });

  it('decodeAudioData rejects → sink.silent, state failed (decode_failed), source.start NOT called', async () => {
    const fakeWav = makeFakeWavBytes();
    const readArtifactBytesSpy = vi.fn(async () => ({
      bytes: fakeWav,
      mimeType: 'audio/wav',
      sizeBytes: fakeWav.byteLength,
    }));
    const mockRuntime = { artifacts: { readArtifactBytes: readArtifactBytesSpy } };
    const fake = createFakeAudioContext(async () => {
      throw new Error('encoding error');
    });
    const sink = createSinkMock();
    const controller = new AudioPipelineController({
      audioContextFactory: () => fake.context,
      logger: { warn: vi.fn(), error: vi.fn() },
    });
    controller.setRuntime(mockRuntime as never);
    controller.registerLipsyncSink(sink);
    const { snapshots } = recordSnapshots(controller);

    await controller.play({
      audioArtifactId: 'artifact-corrupt',
      audioMimeType: 'audio/wav',
    });

    // readArtifactBytes succeeded → decodeAudioData was called → source.start NOT
    // reached (decode throws first).
    expect(readArtifactBytesSpy).toHaveBeenCalledTimes(1);
    expect(fake.decodeAudioData).toHaveBeenCalledTimes(1);
    expect(fake.source.start).not.toHaveBeenCalled();
    expect(sink.attachAudioSource).not.toHaveBeenCalled();
    expect(sink.silent).toHaveBeenCalledTimes(1);
    expect(snapshots.map((s) => s.state)).toEqual(['idle', 'requested', 'failed']);
    expect(snapshots[snapshots.length - 1]?.reason).toBe('decode_failed');
  });
});
