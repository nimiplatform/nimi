import type { SpeechStreamEvent } from './types';

function toBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64');
  }
  let binary = '';
  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index] ?? 0);
  }
  return btoa(binary);
}

export function chunkAudioBytes(bytes: Uint8Array, chunkSize: number): Uint8Array[] {
  if (bytes.length === 0) return [];
  const chunks: Uint8Array[] = [];
  const safeChunkSize = Math.max(1, chunkSize);
  for (let offset = 0; offset < bytes.length; offset += safeChunkSize) {
    chunks.push(bytes.slice(offset, offset + safeChunkSize));
  }
  return chunks;
}

export function buildChunkEvent(input: {
  streamId: string;
  seq: number;
  bytes: Uint8Array;
  durationMs: number;
}): SpeechStreamEvent {
  return {
    type: 'chunk',
    streamId: input.streamId,
    seq: input.seq,
    audioBase64: toBase64(input.bytes),
    durationMs: input.durationMs,
  };
}
