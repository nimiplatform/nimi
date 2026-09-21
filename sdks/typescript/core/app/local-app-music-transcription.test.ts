import assert from 'node:assert/strict';
import test from 'node:test';
import { localMusicTranscribeSpec, runtimeMusicTranscribeSpec, localMusicTranscription, runtimeMusicTranscription,
  validateNimiLocalAppMusicTranscribeSpec, validateNimiLocalAppMusicTranscription } from './local-app-music-transcription.js';
import { projectMusicInputCapabilities } from '../ai/music-input.js';

test('music transcription preserves owned source ranges and requested symbolic output sets', () => {
  const spec = validateNimiLocalAppMusicTranscribeSpec({ type: 'music-transcribe', sourceAudio: { artifactId: 'source-1', range: { startFrame: 960000, endFrame: 10158504 } },
    requestedFormats: ['abc', 'timeline'], requestedParts: ['lead-sheet'] });
  assert.deepEqual(localMusicTranscribeSpec(runtimeMusicTranscribeSpec(spec)), spec);
  for (const change of [{ model: 'hidden-selection' }, { requestedFormats: ['abc', 'abc'] }, { sourceAudio: { artifactId: 'a', range: { startFrame: 2, endFrame: 1 } } }, { requestedParts: ['lyrics'] }]) {
    assert.throws(() => validateNimiLocalAppMusicTranscribeSpec({ ...spec, ...change }));
  }
});
test('transcribed estimates retain source facts and reject missing or unrelated artifacts', () => {
  const artifacts = [{ artifactId: 'score-1', mimeType: 'text/vnd.abc', sizeBytes: 2223 }, { artifactId: 'timeline-1', mimeType: 'application/vnd.nimi.music-timeline+json', sizeBytes: 56791 }];
  const result = validateNimiLocalAppMusicTranscription({ scores: [{ artifactId: 'score-1', format: 'abc', part: 'lead-sheet' }], timelineArtifactId: 'timeline-1',
    origin: 'transcribed-estimate', sourceArtifactId: 'source-1', sourceInfo: { sampleRateHz: 48000, channels: 2, frameCount: 9198504, durationMs: 191635 },
    inputRange: { startFrame: 0, endFrame: 9198504 }, completeness: 'unknown' }, artifacts);
  assert.deepEqual(localMusicTranscription(runtimeMusicTranscription(result)!), result);
  assert.throws(() => validateNimiLocalAppMusicTranscription(result, artifacts.slice(0, 1)));
  assert.throws(() => validateNimiLocalAppMusicTranscription({ ...result, origin: 'generated-plan' }, artifacts));
  assert.throws(() => validateNimiLocalAppMusicTranscription({ ...result, inputRange: { startFrame: 0, endFrame: 9198505 } }, artifacts));
  assert.throws(() => validateNimiLocalAppMusicTranscription({ ...result, confidence: 0.9 }, artifacts));
});
test('transcription profiles do not fabricate a generation profile or implicit format conversion', () => {
  const profile = { formats: ['abc', 'timeline'], parts: ['lead-sheet'], maxDurationSeconds: 600, maxSourceBytes: 536870912, supportsRange: true };
  const result = projectMusicInputCapabilities({ generation: [], transcription: [profile] });
  assert.equal(result.generation.length, 0); assert.deepEqual(result.transcription?.[0]?.formats, ['abc', 'timeline']);
  assert.throws(() => projectMusicInputCapabilities({ generation: [], transcription: [] }));
  assert.throws(() => projectMusicInputCapabilities({ generation: [], transcription: [{ ...profile, maxSourceBytes: 536870913 }] }));
});
