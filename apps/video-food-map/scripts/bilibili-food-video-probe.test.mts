import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildTranscriptionSegments,
  extractBvid,
  resolveSttModel,
  computeExtractionCoverage,
  splitWaveIntoSegments,
} from './lib/bilibili-food-video-probe.mts';

function buildTestWave(sampleRate: number, samples: number[]): Uint8Array {
  const channelCount = 1;
  const bitsPerSample = 16;
  const pcmData = Buffer.alloc(samples.length * 2);
  samples.forEach((sample, index) => {
    pcmData.writeInt16LE(sample, index * 2);
  });
  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + pcmData.length, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channelCount, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * channelCount * (bitsPerSample / 8), 28);
  header.writeUInt16LE(channelCount * (bitsPerSample / 8), 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(pcmData.length, 40);
  return new Uint8Array(Buffer.concat([header, pcmData]));
}

test('extractBvid supports full bilibili urls', () => {
  assert.equal(
    extractBvid('https://www.bilibili.com/video/BV1P2Awz6EUQ/?spm_id_from=333.337.search-card.all.click'),
    'BV1P2Awz6EUQ',
  );
});

test('extractBvid supports raw bvid input', () => {
  assert.equal(extractBvid('BV1P2Awz6EUQ'), 'BV1P2Awz6EUQ');
});

test('resolveSttModel keeps configured stt model for long audio when no long-audio override exists', () => {
  assert.equal(
    resolveSttModel({
      durationSec: 1167,
      mergedEnv: {
        NIMI_LIVE_DASHSCOPE_STT_MODEL_ID: 'qwen3-asr-flash-2026-02-10',
      },
    }),
    'cloud/qwen3-asr-flash-2026-02-10',
  );
});

test('resolveSttModel keeps standard stt model for short audio', () => {
  assert.equal(
    resolveSttModel({
      durationSec: 120,
      mergedEnv: {
        NIMI_LIVE_DASHSCOPE_STT_MODEL_ID: 'qwen3-asr-flash-2026-02-10',
      },
    }),
    'cloud/qwen3-asr-flash-2026-02-10',
  );
});

test('computeExtractionCoverage returns full for short videos', () => {
  const coverage = computeExtractionCoverage(120);
  assert.equal(coverage.state, 'full');
  assert.equal(coverage.processedSegmentCount, 1);
  assert.equal(coverage.processedDurationSec, 120);
  assert.equal(coverage.totalDurationSec, 120);
});

test('computeExtractionCoverage returns leading_segments_only for long videos', () => {
  const coverage = computeExtractionCoverage(1167);
  assert.equal(coverage.state, 'leading_segments_only');
  assert.equal(coverage.processedSegmentCount, 3);
  assert.equal(coverage.processedDurationSec, 720);
  assert.equal(coverage.totalDurationSec, 1167);
});

test('splitWaveIntoSegments slices pcm wav by time window', () => {
  const wav = buildTestWave(2, [100, 200, 300, 400, 500, 600]);
  const segments = splitWaveIntoSegments({
    wavBytes: wav,
    segmentDurationSec: 2,
    maxSegments: 2,
  });
  assert.equal(segments.length, 2);
  assert.equal(segments[0]?.startSec, 0);
  assert.equal(segments[0]?.endSec, 2);
  assert.equal(segments[1]?.startSec, 2);
  assert.equal(segments[1]?.endSec, 3);
  assert.equal(segments[0]?.mimeType, 'audio/wav');
  assert.equal(segments[1]?.mimeType, 'audio/wav');
});

test('buildTranscriptionSegments caps oversized direct audio fallback under grpc limit', () => {
  const audioBytes = new Uint8Array((7 * 1024 * 1024) + 1024);
  const segments = buildTranscriptionSegments({
    shouldSegment: false,
    durationSec: 120,
    audioBytes,
    audioMimeType: 'audio/mp4',
  });
  assert.equal(segments.length, 1);
  assert.ok((segments[0]?.bytes.byteLength || 0) <= 6 * 1024 * 1024);
  assert.ok((segments[0]?.endSec || 0) < 120);
});
