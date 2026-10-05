import { t } from '../../shell/i18n/index.js';
import type { LabRealtimeController } from './ai-realtime-session.js';

export const LAB_AI_REALTIME_MAX_RECORDING_BYTES = 24_000 * 2 * 4;

// Server VAD supplies actual turn signals; sending a file never starts a
// response in that mode. Manual mode keeps its existing explicit owner actions.
export async function sendLabRealtimeRecordingFrames(input: {
  readonly session: Pick<LabRealtimeController, 'appendAudioFrame' | 'ownerControl'>;
  readonly frames: readonly Uint8Array[];
  readonly inputTrackId: string;
  readonly utteranceId: string;
  readonly turnDetection: 'manual' | 'server-vad';
  readonly startResponse?: boolean;
}): Promise<void> {
  for (let index = 0; index < input.frames.length; index += 1) {
    await input.session.appendAudioFrame({
      inputTrackId: input.inputTrackId, utteranceId: input.utteranceId,
      frameSequence: String(index + 1), frame: input.frames[index]!,
    });
  }
  if (input.turnDetection === 'manual') {
    await input.session.ownerControl('commit-input');
    if (input.startResponse !== false) await input.session.ownerControl('start-response');
  }
}

// Recorded input must match the negotiated mono PCM tuple. It does not
// reinterpret samples or silently convert a recording to another rate.
export function readLabRealtimeRecording(buffer: ArrayBuffer, sampleRateHz: 16000 | 24000 = 16000): readonly Uint8Array[] {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  const invalid = () => new Error(t('CapabilityTests.aiRealtime.recordingFormatError'));
  if (bytes.length < 44 || readFourCC(bytes, 0) !== 'RIFF' || readFourCC(bytes, 8) !== 'WAVE' ||
      view.getUint32(4, true) + 8 !== bytes.length) throw invalid();

  let formatSeen = false;
  let audio: Uint8Array | null = null;
  for (let offset = 12; offset + 8 <= bytes.length;) {
    const kind = readFourCC(bytes, offset);
    const length = view.getUint32(offset + 4, true);
    const start = offset + 8;
    const end = start + length;
    if (end > bytes.length) throw invalid();
    if (kind === 'fmt ') {
      if (formatSeen || length < 16 || view.getUint16(start, true) !== 1 ||
          view.getUint16(start + 2, true) !== 1 || view.getUint32(start + 4, true) !== sampleRateHz ||
          view.getUint32(start + 8, true) !== sampleRateHz * 2 || view.getUint16(start + 12, true) !== 2 ||
          view.getUint16(start + 14, true) !== 16) throw invalid();
      formatSeen = true;
    } else if (kind === 'data') {
      if (audio || length === 0 || length % 2 !== 0 || length > sampleRateHz * 2 * 4) throw invalid();
      audio = bytes.slice(start, end);
    }
    offset = end + (length % 2);
    if (offset > bytes.length) throw invalid();
  }
  if (!formatSeen || !audio) throw invalid();
  const frameBytes = sampleRateHz * 2 * 20 / 1000;
  const frames: Uint8Array[] = [];
  for (let offset = 0; offset < audio.length; offset += frameBytes) {
    const frame = new Uint8Array(frameBytes);
    frame.set(audio.subarray(offset, offset + frameBytes));
    frames.push(frame);
  }
  return frames;
}

function readFourCC(bytes: Uint8Array, offset: number): string {
  return String.fromCharCode(...bytes.subarray(offset, offset + 4));
}
