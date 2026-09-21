import { integer, PCM_BLOCK_FRAMES, PCM_MAX_TRACKS, PCM_MAX_WAVEFORM_BINS, PcmError, validatePcmBlock, validatePcmFormat, type PcmFormat } from './types.js';

export interface PcmMixTrack extends PcmFormat { readonly samples: Float32Array; readonly gain: number }
export interface PcmMixInput extends PcmFormat { readonly frameCount: number; readonly tracks: readonly PcmMixTrack[] }
export interface PcmMixResult { readonly samples: Float32Array; readonly peak: number; readonly overRangeSamples: number }

// @nimi-authority: rule.nimi.platform.ui-design-system.p-kit-031-canonical-pcm
/** Input blocks are already placed on the same project frame range. No normalization or channel conversion. */
export function mixPcmBlock(input: PcmMixInput): PcmMixResult {
  validatePcmFormat(input);
  if (!integer(input.frameCount, 1, PCM_BLOCK_FRAMES) || !Array.isArray(input.tracks) || !integer(input.tracks.length, 1, PCM_MAX_TRACKS)) throw new PcmError('PCM_MIX_BOUNDS');
  for (const track of input.tracks) {
    if (track.sampleRateHz !== input.sampleRateHz || track.channels !== input.channels) throw new PcmError('PCM_MIX_DOMAIN_MISMATCH');
    if (!Number.isFinite(track.gain) || Math.abs(track.gain) > 16 || validatePcmBlock(track.samples, input.channels) !== input.frameCount) throw new PcmError('PCM_MIX_TRACK_INVALID');
  }
  const output = new Float32Array(input.frameCount * input.channels);
  let peak = 0; let overRangeSamples = 0;
  for (let i = 0; i < output.length; i += 1) {
    let value = input.tracks[0]!.samples[i]! * input.tracks[0]!.gain;
    for (let track = 1; track < input.tracks.length; track += 1) value += input.tracks[track]!.samples[i]! * input.tracks[track]!.gain;
    output[i] = value;
    if (!Number.isFinite(output[i])) throw new PcmError('PCM_SAMPLE_NON_FINITE');
    peak = Math.max(peak, Math.abs(output[i]!));
    if (Math.abs(output[i]!) > 1) overRangeSamples += 1;
  }
  return { samples: output, peak, overRangeSamples };
}

export interface PcmWaveformInput {
  readonly samples: Float32Array;
  readonly channels: 1 | 2;
  readonly startFrame: number;
  readonly totalFrames: number;
  readonly bins: number;
}
export interface PcmWaveformBlock { readonly firstBin: number; readonly min: Float32Array; readonly max: Float32Array }
/** Min/max across channels, positioned on the complete source timeline. Values are not clamped. */
export function summarizePcmBlock(input: PcmWaveformInput): PcmWaveformBlock {
  const frames = validatePcmBlock(input.samples, input.channels);
  if (!integer(input.totalFrames, 1, 96000 * 600) || !integer(input.bins, 1, Math.min(PCM_MAX_WAVEFORM_BINS, input.totalFrames))
    || !integer(input.startFrame, 0, input.totalFrames - frames)) throw new PcmError('PCM_WAVEFORM_BOUNDS');
  const firstBin = Math.floor(input.startFrame * input.bins / input.totalFrames);
  const lastBin = Math.floor((input.startFrame + frames - 1) * input.bins / input.totalFrames);
  const min = new Float32Array(lastBin - firstBin + 1).fill(Infinity); const max = new Float32Array(min.length).fill(-Infinity);
  for (let frame = 0; frame < frames; frame += 1) {
    const bin = Math.floor((input.startFrame + frame) * input.bins / input.totalFrames) - firstBin;
    for (let channel = 0; channel < input.channels; channel += 1) {
      const value = input.samples[frame * input.channels + channel]!;
      min[bin] = Math.min(min[bin]!, value); max[bin] = Math.max(max[bin]!, value);
    }
  }
  return { firstBin, min, max };
}
