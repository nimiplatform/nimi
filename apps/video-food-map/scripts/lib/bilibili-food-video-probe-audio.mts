import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

type WavePcm16 = {
  sampleRate: number;
  channelCount: number;
  bitsPerSample: number;
  blockAlign: number;
  dataStart: number;
  dataSize: number;
};

export type AudioSegment = {
  index: number;
  startSec: number;
  endSec: number;
  bytes: Uint8Array;
  mimeType: string;
};

function resolveFfmpegBinary(): string {
  const absoluteCandidates = [
    '/opt/homebrew/bin/ffmpeg',
    '/usr/local/bin/ffmpeg',
  ];
  for (const candidate of absoluteCandidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return 'ffmpeg';
}

function parseWavePcm16(bytes: Uint8Array): WavePcm16 {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.byteLength < 44) {
    throw new Error('wav payload is too small');
  }
  if (Buffer.from(bytes.subarray(0, 4)).toString('ascii') !== 'RIFF') {
    throw new Error('wav payload missing RIFF header');
  }
  if (Buffer.from(bytes.subarray(8, 12)).toString('ascii') !== 'WAVE') {
    throw new Error('wav payload missing WAVE signature');
  }

  let offset = 12;
  let sampleRate = 0;
  let channelCount = 0;
  let bitsPerSample = 0;
  let blockAlign = 0;
  let dataStart = 0;
  let dataSize = 0;

  while (offset + 8 <= bytes.byteLength) {
    const chunkId = Buffer.from(bytes.subarray(offset, offset + 4)).toString('ascii');
    const chunkSize = view.getUint32(offset + 4, true);
    const chunkDataStart = offset + 8;
    if (chunkDataStart + chunkSize > bytes.byteLength) {
      throw new Error(`wav chunk ${chunkId} exceeds payload size`);
    }
    if (chunkId === 'fmt ') {
      const audioFormat = view.getUint16(chunkDataStart, true);
      channelCount = view.getUint16(chunkDataStart + 2, true);
      sampleRate = view.getUint32(chunkDataStart + 4, true);
      blockAlign = view.getUint16(chunkDataStart + 12, true);
      bitsPerSample = view.getUint16(chunkDataStart + 14, true);
      if (audioFormat !== 1) {
        throw new Error(`unsupported wav format: ${audioFormat}`);
      }
    }
    if (chunkId === 'data') {
      dataStart = chunkDataStart;
      dataSize = chunkSize;
      break;
    }
    offset = chunkDataStart + chunkSize + (chunkSize % 2);
  }

  if (!sampleRate || !channelCount || !bitsPerSample || !blockAlign || !dataStart || !dataSize) {
    throw new Error('wav payload missing required fmt/data chunks');
  }
  if (bitsPerSample !== 16) {
    throw new Error(`unsupported wav bit depth: ${bitsPerSample}`);
  }

  return {
    sampleRate,
    channelCount,
    bitsPerSample,
    blockAlign,
    dataStart,
    dataSize,
  };
}

function buildWavePcm16(input: {
  sampleRate: number;
  channelCount: number;
  bitsPerSample: number;
  pcmData: Uint8Array;
}): Uint8Array {
  const header = Buffer.alloc(44);
  const byteRate = input.sampleRate * input.channelCount * (input.bitsPerSample / 8);
  const blockAlign = input.channelCount * (input.bitsPerSample / 8);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + input.pcmData.byteLength, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(input.channelCount, 22);
  header.writeUInt32LE(input.sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(input.bitsPerSample, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(input.pcmData.byteLength, 40);
  return new Uint8Array(Buffer.concat([header, Buffer.from(input.pcmData)]));
}

export function splitWaveIntoSegments(input: {
  wavBytes: Uint8Array;
  segmentDurationSec: number;
  maxSegments: number;
}): AudioSegment[] {
  const parsed = parseWavePcm16(input.wavBytes);
  const framesPerSegment = Math.max(1, Math.floor(input.segmentDurationSec * parsed.sampleRate));
  const bytesPerSegment = framesPerSegment * parsed.blockAlign;
  const pcmData = input.wavBytes.subarray(parsed.dataStart, parsed.dataStart + parsed.dataSize);
  const segments: AudioSegment[] = [];
  for (
    let index = 0, startByte = 0;
    startByte < pcmData.byteLength && index < input.maxSegments;
    index += 1, startByte += bytesPerSegment
  ) {
    const endByte = Math.min(pcmData.byteLength, startByte + bytesPerSegment);
    const segmentData = pcmData.subarray(startByte, endByte);
    const startFrame = Math.floor(startByte / parsed.blockAlign);
    const endFrame = Math.floor(endByte / parsed.blockAlign);
    const segmentBytes = buildWavePcm16({
      sampleRate: parsed.sampleRate,
      channelCount: parsed.channelCount,
      bitsPerSample: parsed.bitsPerSample,
      pcmData: segmentData,
    });
    segments.push({
      index: index + 1,
      startSec: startFrame / parsed.sampleRate,
      endSec: endFrame / parsed.sampleRate,
      bytes: segmentBytes,
      mimeType: 'audio/wav',
    });
  }
  return segments;
}

export function transcodeAudioToWavePcm16(input: {
  sourceBytes: Uint8Array;
  sourceFileName: string;
}): Uint8Array {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'nimi-bili-audio-'));
  const inputPath = path.join(tempDir, input.sourceFileName);
  const outputPath = path.join(tempDir, 'audio.wav');
  try {
    writeFileSync(inputPath, input.sourceBytes);
    execFileSync(resolveFfmpegBinary(), [
      '-i', inputPath,
      '-ar', '16000',
      '-ac', '1',
      '-sample_fmt', 's16',
      '-f', 'wav',
      '-y',
      outputPath,
    ], {
      stdio: 'pipe',
    });
    return new Uint8Array(readFileSync(outputPath));
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error || 'unknown error');
    throw new Error(`failed to transcode bilibili audio to wav: ${detail}`, {
      cause: error,
    });
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}
