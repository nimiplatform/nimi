import { t } from '../../shell/i18n/index.js';

const FRAME_BYTES = 640;
export const LAB_AI_REALTIME_MAX_RECORDING_BYTES = 16_000 * 2 * 4;

// Recorded input follows the same negotiated 16 kHz mono PCM frames as the
// microphone. It is intentionally a narrow Lab source, not a format converter.
export function readLabRealtimeRecording(buffer: ArrayBuffer): readonly Uint8Array[] {
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
          view.getUint16(start + 2, true) !== 1 || view.getUint32(start + 4, true) !== 16_000 ||
          view.getUint32(start + 8, true) !== 32_000 || view.getUint16(start + 12, true) !== 2 ||
          view.getUint16(start + 14, true) !== 16) throw invalid();
      formatSeen = true;
    } else if (kind === 'data') {
      if (audio || length === 0 || length % 2 !== 0 || length > LAB_AI_REALTIME_MAX_RECORDING_BYTES) throw invalid();
      audio = bytes.slice(start, end);
    }
    offset = end + (length % 2);
    if (offset > bytes.length) throw invalid();
  }
  if (!formatSeen || !audio) throw invalid();
  const frames: Uint8Array[] = [];
  for (let offset = 0; offset < audio.length; offset += FRAME_BYTES) {
    const frame = new Uint8Array(FRAME_BYTES);
    frame.set(audio.subarray(offset, offset + FRAME_BYTES));
    frames.push(frame);
  }
  return frames;
}

function readFourCC(bytes: Uint8Array, offset: number): string {
  return String.fromCharCode(...bytes.subarray(offset, offset + 4));
}
