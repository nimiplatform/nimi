import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { build } from 'esbuild';

const root = path.resolve(import.meta.dirname, '..');
const buildDir = mkdtempSync(path.join(tmpdir(), 'nimi-lab-capability-params-'));

await build({
  entryPoints: [path.join(root, 'src/lab/lab-studio-composition.ts')],
  outfile: path.join(buildDir, 'lab-capability-params.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'es2022',
  sourcemap: false,
  logLevel: 'silent',
});

const { labStudioComposition } = await import(
  pathToFileURL(path.join(buildDir, 'lab-capability-params.mjs')).href
);

test.after(async () => {
  await rm(buildDir, { recursive: true, force: true });
});

function states(capabilityId, source) {
  return new Map(
    labStudioComposition.getCapability(capabilityId).parameters.presentation(source)
      .map((item) => [item.field, item]),
  );
}

function project(capabilityId, source, parameters) {
  return labStudioComposition.getCapability(capabilityId).parameters.project(source, parameters);
}

test('Local video disables Cloud-only fields and presents fps as fixed 24', () => {
  const local = states('video.generate', 'local');
  for (const field of ['cameraFixed', 'watermark', 'draft', 'serviceTier', 'executionExpiresAfterSec']) {
    assert.equal(local.get(field)?.state, 'disabled', field);
  }
  for (const field of ['negativePrompt', 'resolution', 'frames', 'durationSec', 'ratio', 'seed', 'generateAudio', 'returnLastFrame']) {
    assert.equal(local.get(field)?.state, 'enabled', field);
  }
  assert.deepEqual(local.get('fps'), { field: 'fps', state: 'fixed', fixedValue: 24 });
});

test('Local text preserves admitted fields and image exposes only artifact custody input', () => {
  for (const field of ['topK', 'presencePenalty', 'frequencyPenalty', 'stop', 'seed']) {
    assert.equal(states('text.generate', 'local').has(field), false, `text.generate.${field}`);
    assert.equal(states('chat.stream', 'local').get(field)?.state, 'enabled', `chat.stream.${field}`);
  }
  const localImage = states('image.generate', 'local');
  assert.equal(localImage.get('referenceImageArtifactId')?.state, 'enabled');
  for (const field of ['referenceImage', 'mask']) {
    assert.deepEqual(localImage.get(field), { field, state: 'disabled', unavailableBecause: 'route' });
  }
  const cloudImage = states('image.generate', 'cloud');
  for (const field of ['referenceImage', 'mask']) {
    assert.equal(cloudImage.get(field)?.state, 'enabled', `image.generate.${field}`);
  }
  assert.deepEqual(cloudImage.get('referenceImageArtifactId'), {
    field: 'referenceImageArtifactId', state: 'disabled', unavailableBecause: 'route',
  });
  assert.deepEqual(project('image.generate', 'cloud', {
    referenceImage: 'https://example.test/reference.png',
    referenceImageArtifactId: 'artifact-image-source-1',
  }), {
    referenceImage: 'https://example.test/reference.png',
  });
  assert.deepEqual(project('image.generate', 'local', {
    referenceImage: 'https://example.test/reference.png',
    referenceImageArtifactId: 'artifact-image-source-1',
    mask: 'https://example.test/mask.png',
  }), {
    referenceImageArtifactId: 'artifact-image-source-1',
  });
});

test('Local synthesis exposes only preset voice references until Runtime owns voice asset resolution', () => {
  const local = states('audio.synthesize', 'local');
  assert.deepEqual(local.get('voiceKind'), { field: 'voiceKind', state: 'fixed', fixedValue: 'preset' });
  assert.equal(local.get('voicePreset')?.state, 'enabled', 'audio.synthesize.voicePreset');
  assert.deepEqual(local.get('voiceAssetId'), {
    field: 'voiceAssetId',
    state: 'disabled',
    unavailableBecause: 'route',
  });
  assert.deepEqual(project('audio.synthesize', 'local', {
    voiceKind: 'asset',
    voicePreset: 'vivian',
    voiceAssetId: 'voice-asset-1',
    timingMode: 'word',
  }), {
    voiceKind: 'preset',
    voicePreset: 'vivian',
  });
});

test('Local transcription admits its supported inputs and drops unsupported options', () => {
  const local = states('audio.transcribe', 'local');
  for (const field of ['audioFile', 'mimeType', 'language']) {
    assert.equal(local.get(field)?.state, 'enabled', `audio.transcribe.${field}`);
  }
  assert.deepEqual(local.get('responseFormat'), { field: 'responseFormat', state: 'fixed', fixedValue: 'text' });
  for (const field of ['timestamps', 'diarization', 'speakerCount', 'prompt']) {
    assert.equal(local.get(field)?.state, 'disabled', `audio.transcribe.${field}`);
  }
  assert.deepEqual(project('audio.transcribe', 'local', {
    audioFile: { name: 'sample.wav' },
    mimeType: 'audio/wav',
    language: 'en',
    responseFormat: 'json',
    timestamps: true,
    prompt: 'speaker names',
  }), {
    audioFile: { name: 'sample.wav' },
    mimeType: 'audio/wav',
    language: 'en',
    responseFormat: 'text',
  });
});

test('Local voice creation exposes both typed source request shapes', () => {
  const local = states('voice.create', 'local');
  for (const field of [
    'creationSource',
    'referenceAudioFile',
    'languageHints',
    'preferredName',
    'previewText',
    'language',
  ]) {
    assert.equal(local.get(field)?.state, 'enabled', `voice.create.${field}`);
  }
});

test('Cloud enables carrier fields but not private Local App scheduling fields', () => {
  for (const capabilityId of [
    'text.generate',
    'chat.stream',
    'text.embed',
    'image.generate',
    'video.generate',
    'audio.synthesize',
    'audio.transcribe',
    'voice.create',
  ]) {
    for (const [field, item] of states(capabilityId, 'cloud')) {
      if (capabilityId === 'video.generate' && ['serviceTier', 'executionExpiresAfterSec'].includes(field)) {
        assert.deepEqual(item, { field, state: 'disabled', unavailableBecause: 'local-app-surface' });
      } else if (capabilityId === 'image.generate' && field === 'referenceImageArtifactId') {
        assert.deepEqual(item, { field, state: 'disabled', unavailableBecause: 'route' });
      } else {
        assert.equal(item.state, 'enabled', `${capabilityId}.${field}`);
      }
    }
  }
});

test('presentation recomputes immediately from the selected route', () => {
  assert.equal(states('image.generate', 'local').get('quality')?.state, 'disabled');
  assert.equal(states('image.generate', 'cloud').get('quality')?.state, 'enabled');
  assert.equal(states('image.generate', 'unknown').get('quality')?.state, 'enabled');
});

test('request projection drops disabled drafts and applies fixed route values', () => {
  assert.deepEqual(project('video.generate', 'local', {
    resolution: '512x288',
    fps: 30,
    cameraFixed: true,
    serviceTier: 'priority',
  }), {
    resolution: '512x288',
    fps: 24,
  });
  assert.deepEqual(project('video.generate', 'cloud', {
    fps: 30,
    cameraFixed: true,
    serviceTier: 'priority',
  }), {
    fps: 30,
    cameraFixed: true,
  });
  assert.deepEqual(project('text.generate', 'local', {
    temperature: 0,
    topK: 40,
    stop: ['END'],
  }), { temperature: 0 });
  assert.deepEqual(project('chat.stream', 'local', {
    topK: 40,
    stop: ['END'],
  }), { topK: 40, stop: ['END'] });
});
