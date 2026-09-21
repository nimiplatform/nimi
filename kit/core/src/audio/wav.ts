import { abortable, integer, PCM_BLOCK_FRAMES, PcmError, validatePcmBlock, validatePcmInfo,
  type CanonicalWav, type PcmAudioInfo, type PcmByteSource } from './types.js';

const text = (bytes: Uint8Array, start: number, length: number) => String.fromCharCode(...bytes.subarray(start, start + length));
const view = (bytes: Uint8Array) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
// Protected asset ReadOpen verifies the immutable complete payload. Reuse one
// bounded read-ahead window instead of opening that payload for every PCM block.
// DSP windows remain 16,384 frames; this byte cache is at most one MiB per source.
function bufferedSource(source: PcmByteSource): PcmByteSource {
  let start = 0; let bytes: Uint8Array = new Uint8Array(0); let reading = false;
  return { sizeBytes: source.sizeBytes, read: async (offset, length, signal) => {
    signal?.throwIfAborted();
    if (offset >= start && offset + length <= start + bytes.length) return bytes.slice(offset - start, offset - start + length);
    if (reading) throw new PcmError('PCM_READER_BUSY');
    reading = true;
    try {
      const count = Math.min(1024 * 1024, source.sizeBytes - offset);
      const next = await source.read(offset, count, signal); signal?.throwIfAborted();
      if (!(next instanceof Uint8Array) || next.length !== count) throw new PcmError('PCM_RANGE_INCOMPLETE');
      start = offset; bytes = next;
      return bytes.slice(0, length);
    } finally { reading = false; }
  } };
}
async function read(source: PcmByteSource, offset: number, length: number, signal?: AbortSignal): Promise<Uint8Array> {
  signal?.throwIfAborted();
  if (!integer(offset, 0, source.sizeBytes) || !integer(length, 1, PCM_BLOCK_FRAMES * 8) || offset + length > source.sizeBytes) throw new PcmError('PCM_RANGE_INVALID');
  const bytes = await abortable(source.read(offset, length, signal), signal);
  signal?.throwIfAborted();
  if (!(bytes instanceof Uint8Array) || bytes.byteLength !== length) throw new PcmError('PCM_RANGE_INCOMPLETE');
  return bytes;
}

// @nimi-authority: rule.nimi.platform.ui-design-system.p-kit-031-canonical-pcm
/** Inspect format and exact frame count. Samples are validated when read, not by this header-only operation. */
export async function inspectCanonicalWav(source: PcmByteSource, signal?: AbortSignal): Promise<CanonicalWav> {
  if (!integer(source.sizeBytes, 58, 512 * 1024 * 1024)) throw new PcmError('PCM_FILE_SIZE_INVALID');
  source = bufferedSource(source);
  const header = await read(source, 0, 12, signal);
  if (text(header, 0, 4) !== 'RIFF' || text(header, 8, 4) !== 'WAVE' || view(header).getUint32(4, true) + 8 !== source.sizeBytes) throw new PcmError('PCM_WAV_INVALID');
  let format: { channels: 1 | 2; sampleRateHz: number } | undefined;
  let dataOffset = 0; let dataBytes = 0; let factFrames: number | undefined;
  let chunks = 0;
  for (let offset = 12; offset < source.sizeBytes;) {
    if (++chunks > 256) throw new PcmError('PCM_WAV_CHUNKS_EXCEEDED');
    const chunk = await read(source, offset, 8, signal);
    const size = view(chunk).getUint32(4, true); const payload = offset + 8;
    const next = payload + size + (size % 2);
    if (next > source.sizeBytes) throw new PcmError('PCM_WAV_INVALID');
    switch (text(chunk, 0, 4)) {
      case 'fmt ': {
        if (format || ![16, 18, 40].includes(size)) throw new PcmError('PCM_WAV_FORMAT_INVALID');
        const bytes = await read(source, payload, size, signal); const fields = view(bytes);
        const tag = fields.getUint16(0, true);
        if (tag === 0xfffe && size === 40) {
          const guid = [3, 0, 0, 0, 0, 0, 16, 0, 128, 0, 0, 170, 0, 56, 155, 113];
          if (fields.getUint16(16, true) !== 22 || fields.getUint16(18, true) !== 32 || guid.some((v, i) => bytes[24 + i] !== v)) throw new PcmError('PCM_WAV_ENCODING_UNSUPPORTED');
        } else if (tag !== 3 || size === 40 || (size === 18 && fields.getUint16(16, true) !== 0)) throw new PcmError('PCM_WAV_ENCODING_UNSUPPORTED');
        const channels = fields.getUint16(2, true); const rate = fields.getUint32(4, true);
        if (![1, 2].includes(channels) || fields.getUint16(14, true) !== 32 || fields.getUint16(12, true) !== channels * 4 || fields.getUint32(8, true) !== rate * channels * 4) throw new PcmError('PCM_WAV_FORMAT_INVALID');
        format = { channels: channels as 1 | 2, sampleRateHz: rate }; break;
      }
      case 'data':
        if (dataOffset || !size) throw new PcmError('PCM_WAV_DATA_INVALID');
        dataOffset = payload; dataBytes = size; break;
      case 'fact':
        if (factFrames !== undefined || size !== 4) throw new PcmError('PCM_WAV_FACT_INVALID');
        factFrames = view(await read(source, payload, 4, signal)).getUint32(0, true); break;
    }
    offset = next;
  }
  if (!format || !dataOffset || factFrames === undefined || dataBytes % (format.channels * 4)) throw new PcmError('PCM_WAV_INCOMPLETE');
  const info: PcmAudioInfo = { ...format, frameCount: dataBytes / (format.channels * 4) };
  validatePcmInfo(info);
  if (info.frameCount !== factFrames) throw new PcmError('PCM_WAV_FACT_INVALID');
  return Object.freeze({ source, info: Object.freeze(info), dataOffset });
}

export async function readPcmFrames(wav: CanonicalWav, startFrame: number, frameCount: number, signal?: AbortSignal): Promise<Float32Array> {
  if (!integer(startFrame, 0, wav.info.frameCount) || !integer(frameCount, 1, PCM_BLOCK_FRAMES) || startFrame + frameCount > wav.info.frameCount) throw new PcmError('PCM_RANGE_INVALID');
  const bytes = await read(wav.source, wav.dataOffset + startFrame * wav.info.channels * 4, frameCount * wav.info.channels * 4, signal);
  const values = new Float32Array(frameCount * wav.info.channels); const fields = view(bytes);
  for (let i = 0; i < values.length; i += 1) values[i] = fields.getFloat32(i * 4, true);
  validatePcmBlock(values, wav.info.channels); return values;
}

export async function* streamPcmFrames(wav: CanonicalWav, signal?: AbortSignal): AsyncGenerator<Float32Array> {
  for (let start = 0; start < wav.info.frameCount; start += PCM_BLOCK_FRAMES) {
    yield await readPcmFrames(wav, start, Math.min(PCM_BLOCK_FRAMES, wav.info.frameCount - start), signal);
  }
}

export function canonicalWavHeader(info: PcmAudioInfo): Uint8Array {
  validatePcmInfo(info);
  const bytes = new Uint8Array(58); const fields = view(bytes); const dataBytes = info.frameCount * info.channels * 4;
  const put = (offset: number, value: string) => bytes.set(new TextEncoder().encode(value), offset);
  put(0, 'RIFF'); fields.setUint32(4, dataBytes + 50, true); put(8, 'WAVEfmt ');
  fields.setUint32(16, 18, true); fields.setUint16(20, 3, true); fields.setUint16(22, info.channels, true);
  fields.setUint32(24, info.sampleRateHz, true); fields.setUint32(28, info.sampleRateHz * info.channels * 4, true);
  fields.setUint16(32, info.channels * 4, true); fields.setUint16(34, 32, true);
  put(38, 'fact'); fields.setUint32(42, 4, true); fields.setUint32(46, info.frameCount, true);
  put(50, 'data'); fields.setUint32(54, dataBytes, true); return bytes;
}

/** The sink must commit atomically only after the generator completes successfully. */
export async function* encodePcmWav(info: PcmAudioInfo, blocks: AsyncIterable<Float32Array>, signal?: AbortSignal): AsyncGenerator<Uint8Array> {
  signal?.throwIfAborted(); yield canonicalWavHeader(info);
  let frames = 0;
  const iterator = blocks[Symbol.asyncIterator](); let complete = false;
  try {
    while (true) {
      signal?.throwIfAborted();
      const next = await abortable(iterator.next(), signal);
      if (next.done) { complete = true; break; }
      const samples = next.value;
      signal?.throwIfAborted(); frames += validatePcmBlock(samples, info.channels);
      if (frames > info.frameCount) throw new PcmError('PCM_EXPORT_FRAME_COUNT');
      const bytes = new Uint8Array(samples.length * 4); const fields = view(bytes);
      for (let i = 0; i < samples.length; i += 1) fields.setFloat32(i * 4, samples[i]!, true);
      yield bytes;
    }
  } finally {
    // Do not let an upstream stalled read delay cancellation of the atomic sink.
    if (!complete && iterator.return) void Promise.resolve(iterator.return()).catch(() => undefined);
  }
  signal?.throwIfAborted();
  if (frames !== info.frameCount) throw new PcmError('PCM_EXPORT_FRAME_COUNT');
}
