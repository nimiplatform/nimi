import { summarizePcmBlock } from './blocks.js';
import { integer, PCM_BLOCK_FRAMES, PCM_MAX_WAVEFORM_BINS, PcmError, type CanonicalWav } from './types.js';
import { readPcmFrames } from './wav.js';
import type { PcmWorkerClient } from './worker.js';

export interface PcmWaveform { readonly min: Float32Array; readonly max: Float32Array }
export async function buildPcmWaveform(wav: CanonicalWav, bins: number, options: {
  readonly signal?: AbortSignal;
  readonly worker?: Pick<PcmWorkerClient, 'waveform'>;
  readonly onProgress?: (completedFrames: number, totalFrames: number) => void;
} = {}): Promise<PcmWaveform> {
  const { frameCount: totalFrames, channels } = wav.info;
  if (!integer(bins, 1, Math.min(PCM_MAX_WAVEFORM_BINS, totalFrames))) throw new PcmError('PCM_WAVEFORM_BOUNDS');
  const min = new Float32Array(bins).fill(Infinity); const max = new Float32Array(bins).fill(-Infinity);
  for (let startFrame = 0; startFrame < totalFrames; startFrame += PCM_BLOCK_FRAMES) {
    const count = Math.min(PCM_BLOCK_FRAMES, totalFrames - startFrame);
    const samples = await readPcmFrames(wav, startFrame, count, options.signal);
    const input = { samples, channels, startFrame, totalFrames, bins };
    const block = options.worker ? await options.worker.waveform(input, options.signal) : summarizePcmBlock(input);
    options.signal?.throwIfAborted();
    for (let i = 0; i < block.min.length; i += 1) {
      const bin = block.firstBin + i;
      min[bin] = Math.min(min[bin]!, block.min[i]!); max[bin] = Math.max(max[bin]!, block.max[i]!);
    }
    options.onProgress?.(startFrame + count, totalFrames);
  }
  return { min, max };
}
