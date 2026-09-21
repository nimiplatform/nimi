import assert from 'node:assert/strict';
import test from 'node:test';
import { localMusicGenerateSpec, runtimeMusicGenerateSpec, localMusicGeneration, runtimeMusicGeneration,
  validateNimiLocalAppMusicGenerateSpec, validateNimiLocalAppMusicGeneration } from './local-app-music.js';
import { validateNimiLocalAppArtifactUploadResult, validateNimiLocalAppArtifactUploadShellInput } from './local-app-runtime-platform-ai.js';

test('music input preserves score, exact multiline content and explicit zero seed across the wire', () => {
  const input = validateNimiLocalAppMusicGenerateSpec({ type: 'music-generate', prompt: ' quiet folk\n', lyrics: '\n[Verse]\nA line\n\n',
    seed: 0, durationSeconds: 240, instrumental: false, returnGeneratedScore: false,
    score: { artifactId: 'artifact_score', format: 'abc' }, scoreConditioning: 'melody-only',
    audioReference: { artifactId: 'artifact_audio', range: { startFrame: 100, endFrame: 480000 } } });
  assert.deepEqual(localMusicGenerateSpec(runtimeMusicGenerateSpec(input)), input);
  for (const invalid of [
    { ...input, durationSeconds: 601 }, { ...input, seed: -1 }, { ...input, seed: 2 ** 32 },
    { ...input, instrumental: true }, { ...input, score: undefined },
    { ...input, audioReference: { artifactId: 'audio', range: { startFrame: 10, endFrame: 10 } } },
    { ...input, engineOptions: { cot: 'full' } }, { ...input, prompt: 'bad\u0000text' },
  ]) assert.throws(() => validateNimiLocalAppMusicGenerateSpec(invalid));
  assert.doesNotThrow(() => validateNimiLocalAppMusicGenerateSpec({ type: 'music-generate', prompt: 'Piano', lyrics: '', instrumental: true }));
});

test('music result keeps the complete artifact set, score provenance and truncation', () => {
  // Contract fixtures; these are not model outputs or App acceptance evidence.
  const artifacts = [
    { artifactId: 'mix', mimeType: 'audio/wav', sampleRateHz: 48000, channels: 2, frameCount: 48000, durationMs: 1000, sizeBytes: 384058 },
    { artifactId: 'score', mimeType: 'text/vnd.abc', sizeBytes: 40 },
  ];
  const value = validateNimiLocalAppMusicGeneration({ mixArtifactId: 'mix', termination: 'budget-limit', actualSeed: 4294967295,
    audioInfo: { sampleRateHz: 48000, channels: 2, frameCount: 48000, durationMs: 1000 },
    generatedScore: { artifactId: 'score', format: 'abc', origin: 'generated-plan', truncated: true } }, artifacts);
  assert.deepEqual(localMusicGeneration(runtimeMusicGeneration(value)!), value);
  assert.throws(() => validateNimiLocalAppMusicGeneration(value, artifacts.slice(0, 1)));
  assert.throws(() => validateNimiLocalAppMusicGeneration({ ...value, termination: 'complete' }, artifacts));
  assert.throws(() => validateNimiLocalAppMusicGeneration({ ...value, audioInfo: { ...value.audioInfo, frameCount: 48001 } }, artifacts));
  assert.throws(() => validateNimiLocalAppMusicGeneration({ ...value, generatedScore: { ...value.generatedScore, origin: 'input' } }, artifacts));
});

test('ABC import is bounded inline content with an explicit recovery expiry', () => {
  const input = validateNimiLocalAppArtifactUploadShellInput({ bytes: [88, 58, 49], mimeType: 'text/vnd.abc' });
  const result = { artifactId: 'score', sizeBytes: 3, mimeType: 'text/vnd.abc', expiresAt: { seconds: '2000000000', nanos: 0 } };
  assert.deepEqual(validateNimiLocalAppArtifactUploadResult(result, input), result);
  assert.throws(() => validateNimiLocalAppArtifactUploadResult({ ...result, expiresAt: undefined }, input));
  assert.throws(() => validateNimiLocalAppArtifactUploadShellInput({ bytes: Array(1048577).fill(0), mimeType: 'text/vnd.abc' }));
});
