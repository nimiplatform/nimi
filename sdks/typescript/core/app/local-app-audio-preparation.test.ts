import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createNimiLocalAppAIConsumptionRuntimeClient,
  validateNimiLocalAppArtifactUploadResult,
  validateNimiLocalAppArtifactUploadShellInput,
  type NimiLocalAppAIConsumptionRuntime,
} from './local-app-runtime-platform-ai.js';

const canonicalInput = {
  source: { kind: 'app-asset', relativePath: 'sources/原曲.mp3' },
  mimeType: 'audio/mpeg',
  audioPreparation: { profile: 'canonical-pcm-v1' },
};
const metadata = {
  artifactId: 'artifact-canonical-1', sizeBytes: 73588090, mimeType: 'audio/wav',
  audioInfo: { sampleRateHz: 48000, channels: 2, frameCount: 9198504, durationMs: 191635 },
};

test('canonical metadata permits large custody without adding inline bytes', () => {
  const input = validateNimiLocalAppArtifactUploadShellInput(canonicalInput);
  assert.deepEqual(validateNimiLocalAppArtifactUploadResult(metadata, input), metadata);
  assert.equal(input.bytes, undefined);
});

test('audio preparation rejects conflicting sources and authority material', () => {
  for (const invalid of [
    { ...canonicalInput, bytes: [1] },
    { ...canonicalInput, source: { ...canonicalInput.source, accountId: 'another-owner' } },
    { ...canonicalInput, source: { kind: 'host-path', path: 'C:/private.wav' } },
    { ...canonicalInput, audioPreparation: undefined },
    { ...canonicalInput, audioPreparation: { profile: 'other' } },
    { ...canonicalInput, audioPreparation: { profile: 'canonical-pcm-v1', targetSampleRateHz: 48000 } },
    { ...canonicalInput, source: { kind: 'artifact', artifactId: 'artifact-1' } },
    { bytes: [1], mimeType: 'audio/flac' },
  ]) assert.throws(() => validateNimiLocalAppArtifactUploadShellInput(invalid));
});

test('canonical result requires observed consistent audio facts', () => {
  const input = validateNimiLocalAppArtifactUploadShellInput(canonicalInput);
  for (const invalid of [
    { ...metadata, audioInfo: undefined },
    { ...metadata, mimeType: 'audio/mpeg' },
    { ...metadata, sizeBytes: 100 },
    { ...metadata, audioInfo: { ...metadata.audioInfo, frameCount: 0 } },
    { ...metadata, audioInfo: { ...metadata.audioInfo, durationMs: 200000 } },
    { ...metadata, audioInfo: { ...metadata.audioInfo, decoderPath: '/private/ffmpeg' } },
  ]) assert.throws(() => validateNimiLocalAppArtifactUploadResult(invalid, input));
});

test('serialized audio bytes cannot hide malformed indexed values behind an iterator', () => {
  const bytes: unknown[] = [{ accountId: 'hidden-owner' }];
  bytes[Symbol.iterator] = function* () { yield 0; };
  assert.throws(() => validateNimiLocalAppArtifactUploadShellInput({ bytes, mimeType: 'audio/wav' }));
});

test('Runtime SDK maps the finite source and facts without losing preparation', async () => {
  // Wire projection test only; the fabricated response is not an audio result
  // or evidence of protected Runtime / App acceptance.
  const requests: unknown[] = [];
  const runtime = {
    async uploadLocalAppArtifact(request: unknown) {
      requests.push(request);
      return { ...metadata, sizeBytes: String(metadata.sizeBytes),
        audioInfo: { ...metadata.audioInfo, frameCount: String(metadata.audioInfo.frameCount), durationMs: String(metadata.audioInfo.durationMs) } };
    },
  } as unknown as NimiLocalAppAIConsumptionRuntime;
  const client = createNimiLocalAppAIConsumptionRuntimeClient(runtime);
  const result = await client.artifacts.upload({
    source: { kind: 'app-asset', relativePath: 'sources/原曲.mp3' },
    mimeType: 'audio/mpeg', audioPreparation: { profile: 'canonical-pcm-v1' },
  });
  assert.deepEqual(result, metadata);
  assert.deepEqual(requests, [{ bytes: new Uint8Array(), mimeType: 'audio/mpeg',
    appAssetRelativePath: 'sources/原曲.mp3', sourceArtifactId: '', audioPreparation: { targetSampleRateHz: 0 } }]);
});
