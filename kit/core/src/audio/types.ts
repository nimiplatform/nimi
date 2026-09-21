// @nimi-authority: rule.nimi.platform.ui-design-system.p-kit-031-canonical-pcm
export const PCM_BLOCK_FRAMES = 16_384;
export const PCM_MAX_TRACKS = 8;
export const PCM_MAX_WAVEFORM_BINS = 65_536;
export interface PcmFormat { readonly sampleRateHz: number; readonly channels: 1 | 2 }
export interface PcmAudioInfo extends PcmFormat { readonly frameCount: number }
export interface PcmByteSource {
  readonly sizeBytes: number;
  /** Return exactly the requested range of the pinned immutable source. */
  readonly read: (offset: number, length: number, signal?: AbortSignal) => Promise<Uint8Array>;
}
export interface CanonicalWav {
  readonly source: PcmByteSource;
  readonly info: PcmAudioInfo;
  readonly dataOffset: number;
}
export class PcmError extends Error {
  constructor(readonly code: string) { super(code); this.name = 'PcmError'; }
}
export function integer(value: number, min: number, max: number): boolean {
  return Number.isSafeInteger(value) && value >= min && value <= max;
}
export function validatePcmFormat(format: PcmFormat): void {
  if (!integer(format.sampleRateHz, 8000, 96000) || ![1, 2].includes(format.channels)) throw new PcmError('PCM_FORMAT_UNSUPPORTED');
}
export function validatePcmInfo(info: PcmAudioInfo): void {
  validatePcmFormat(info);
  if (!integer(info.frameCount, 1, info.sampleRateHz * 600)) throw new PcmError('PCM_DURATION_INVALID');
}
export function validatePcmBlock(samples: Float32Array, channels: number): number {
  if (!(samples instanceof Float32Array) || ![1, 2].includes(channels)
    || !samples.length || samples.length % channels || samples.length > PCM_BLOCK_FRAMES * channels) throw new PcmError('PCM_BLOCK_INVALID');
  for (const value of samples) if (!Number.isFinite(value)) throw new PcmError('PCM_SAMPLE_NON_FINITE');
  return samples.length / channels;
}

export async function abortable<T>(operation: Promise<T>, signal?: AbortSignal): Promise<T> {
  signal?.throwIfAborted();
  if (!signal) return operation;
  let aborted: () => void = () => {};
  try {
    return await Promise.race([operation, new Promise<never>((_, reject) => {
      aborted = () => reject(signal.reason ?? new DOMException('Canceled', 'AbortError'));
      signal.addEventListener('abort', aborted, { once: true });
      if (signal.aborted) aborted();
    })]);
  } finally { signal.removeEventListener('abort', aborted); }
}
