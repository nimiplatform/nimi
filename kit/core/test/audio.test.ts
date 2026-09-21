import { describe, expect, it } from 'vitest';
import { buildPcmWaveform, canonicalWavHeader, encodePcmWav, inspectCanonicalWav, mixPcmBlock, readPcmFrames,
  PCM_BLOCK_FRAMES, createPcmWorkerClient, type PcmByteSource } from '../src/audio/index.js';

const info = { sampleRateHz: 48000, channels: 2 as const, frameCount: 3 };
const fromBytes = (bytes: Uint8Array): PcmByteSource => ({ sizeBytes: bytes.length, read: async (offset, length) => bytes.slice(offset, offset + length) });
async function encoded(samples: Float32Array, format = info): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of encodePcmWav(format, (async function* () { yield samples; })())) chunks.push(chunk);
  const result = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0)); let at = 0;
  for (const chunk of chunks) { result.set(chunk, at); at += chunk.length; } return result;
}

describe('canonical PCM frames', () => {
  it('retains float samples and frame coordinates through a complete WAV without browser decoding', async () => {
    const samples = new Float32Array([0, -0, 1.25, -2, 0.1234567, -0.1234567]);
    const bytes = await encoded(samples);
    const wav = await inspectCanonicalWav(fromBytes(bytes));
    expect(wav.info).toEqual(info); expect(wav.dataOffset).toBe(58);
    const frames = await readPcmFrames(wav, 1, 2);
    expect(new Uint8Array(frames.buffer)).toEqual(new Uint8Array(samples.buffer, 8));
    expect(Object.is((await readPcmFrames(wav, 0, 1))[1], -0)).toBe(true);
    await expect(readPcmFrames(wav, 1, 3)).rejects.toThrow('PCM_RANGE_INVALID');
  });
  it('rejects truncated files, incorrect facts and missing finite samples separately', async () => {
    const bytes = await encoded(new Float32Array(6));
    await expect(inspectCanonicalWav(fromBytes(bytes.slice(0, -1)))).rejects.toThrow('PCM_WAV_INVALID');
    const wrongFacts = bytes.slice(); new DataView(wrongFacts.buffer).setUint32(46, 2, true);
    await expect(inspectCanonicalWav(fromBytes(wrongFacts))).rejects.toThrow('PCM_WAV_FACT_INVALID');
    const nonfinite = bytes.slice(); new DataView(nonfinite.buffer).setFloat32(58, NaN, true);
    const wav = await inspectCanonicalWav(fromBytes(nonfinite));
    await expect(readPcmFrames(wav, 0, 1)).rejects.toThrow('PCM_SAMPLE_NON_FINITE');
    await expect(inspectCanonicalWav({ sizeBytes: bytes.length, read: async () => new Uint8Array(1) })).rejects.toThrow('PCM_RANGE_INCOMPLETE');
  });
  it('cancels a stalled range read and never returns header success', async () => {
    const controller = new AbortController();
    const read = inspectCanonicalWav({ sizeBytes: 100, read: () => new Promise(() => {}) }, controller.signal);
    controller.abort(new Error('explicit cancel'));
    await expect(read).rejects.toThrow('explicit cancel');
  });
  it('rejects early and extra export frames rather than yielding successful partial output', async () => {
    const consume = async (samples: Float32Array) => { for await (const _ of encodePcmWav(info, (async function* () { yield samples; })())) { /* bounded sink */ } };
    await expect(consume(new Float32Array(4))).rejects.toThrow('PCM_EXPORT_FRAME_COUNT');
    await expect(consume(new Float32Array(8))).rejects.toThrow('PCM_EXPORT_FRAME_COUNT');
  });
  it('cancels an export while its next input block is stalled', async () => {
    const controller = new AbortController(); let released = false;
    const blocks = { [Symbol.asyncIterator]: () => ({ next: () => new Promise<IteratorResult<Float32Array>>(() => {}),
      return: async () => { released = true; return { done: true as const, value: undefined }; } }) };
    const output = encodePcmWav(info, blocks, controller.signal);
    await output.next(); const pending = output.next();
    controller.abort(new Error('cancel export'));
    await expect(pending).rejects.toThrow('cancel export'); expect(released).toBe(true);
  });
  it('preserves min/max at block boundaries and bounds every read of a five-minute source', async () => {
    // Synthetic changing samples test media resource bounds, not complete-song model support.
    const full = { sampleRateHz: 48000, channels: 2 as const, frameCount: 48000 * 300 };
    const header = canonicalWavHeader(full); let maxRead = 0; let totalRead = 0;
    const source: PcmByteSource = { sizeBytes: 58 + full.frameCount * 8, read: async (offset, length) => {
      maxRead = Math.max(maxRead, length); totalRead += length;
      if (offset < 58) return header.slice(offset, offset + length);
      const bytes = new Uint8Array(length); const data = new DataView(bytes.buffer);
      for (let i = 0; i < length / 4; i += 1) data.setFloat32(i * 4, ((offset - 58) / 4 + i) % 2 ? -0.25 : 0.5, true);
      return bytes;
    } };
    const peaks = await buildPcmWaveform(await inspectCanonicalWav(source), 257);
    expect([...peaks.min].every(n => n === -0.25)).toBe(true);
    expect([...peaks.max].every(n => n === 0.5)).toBe(true);
    expect(maxRead).toBe(PCM_BLOCK_FRAMES * 8);
    expect(totalRead).toBe(source.sizeBytes);
  });
});

it('mixes same-domain tracks without clipping and rejects hidden sample-rate conversion', () => {
  const format = { sampleRateHz: 48000, channels: 1 as const, frameCount: 2 };
  const tracks = [{ ...format, gain: 0.5, samples: new Float32Array([0.75, -0.5]) }, { ...format, gain: 1, samples: new Float32Array([1, -1]) }];
  const result = mixPcmBlock({ ...format, tracks });
  expect([...result.samples]).toEqual([1.375, -1.25]); expect(result.peak).toBe(1.375); expect(result.overRangeSamples).toBe(2);
  expect(() => mixPcmBlock({ ...format, tracks: [tracks[0]!, { ...tracks[1]!, sampleRateHz: 44100 }] })).toThrow('PCM_MIX_DOMAIN_MISMATCH');
  expect(() => mixPcmBlock({ ...format, tracks: Array(9).fill(tracks[0]) })).toThrow('PCM_MIX_BOUNDS');
  const negativeZero = mixPcmBlock({ ...format, frameCount: 1, tracks: [{ ...format, gain: 1, samples: new Float32Array([-0]) }] });
  expect(Object.is(negativeZero.samples[0], -0)).toBe(true);
});

it('rejects a second Worker request and releases the pending operation on cancellation', async () => {
  // Fault injection covers lifecycle only; actual Worker execution is validated separately.
  const events = new EventTarget(); let stopped = false;
  const worker = { addEventListener: events.addEventListener.bind(events), removeEventListener: events.removeEventListener.bind(events),
    postMessage: () => {}, terminate: () => { stopped = true; } } as unknown as Worker;
  const client = createPcmWorkerClient(worker); const controller = new AbortController();
  const input = { sampleRateHz: 48000, channels: 1 as const, frameCount: 1, tracks: [{ sampleRateHz: 48000, channels: 1 as const, gain: 1, samples: new Float32Array([0]) }] };
  const pending = client.mix(input, controller.signal);
  await expect(client.mix(input)).rejects.toThrow('PCM_WORKER_BUSY');
  controller.abort(new Error('cancel mix'));
  await expect(pending).rejects.toThrow('cancel mix'); expect(stopped).toBe(true);
  await expect(client.mix(input)).rejects.toThrow('PCM_WORKER_CLOSED');
});
