import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { build } from 'esbuild';

const root = path.resolve(import.meta.dirname, '..');
const buildDir = mkdtempSync(path.join(tmpdir(), 'nimi-tester-capability-params-'));

await build({
  entryPoints: [path.join(root, 'src/tester/tester-capability-params.ts')],
  outfile: path.join(buildDir, 'tester-capability-params.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'es2022',
  sourcemap: false,
  logLevel: 'silent',
});

const { getTesterCapabilityParamPresentation, projectTesterCapabilityParamsForRoute } = await import(
  pathToFileURL(path.join(buildDir, 'tester-capability-params.mjs')).href
);

test.after(async () => {
  await rm(buildDir, { recursive: true, force: true });
});

function states(capabilityId, source) {
  return new Map(
    getTesterCapabilityParamPresentation(capabilityId, source)
      .map((item) => [item.field, item]),
  );
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

test('Local text and image preserve every field admitted by the Local App carrier', () => {
  for (const capabilityId of ['text.generate', 'chat.stream']) {
    for (const field of ['topK', 'presencePenalty', 'frequencyPenalty', 'stop', 'seed']) {
      assert.equal(states(capabilityId, 'local').get(field)?.state, 'enabled', `${capabilityId}.${field}`);
    }
  }
  for (const field of ['referenceImage', 'mask']) {
    assert.equal(states('image.generate', 'local').get(field)?.state, 'enabled', `image.generate.${field}`);
  }
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
  assert.deepEqual(projectTesterCapabilityParamsForRoute('audio.synthesize', 'local', {
    voiceKind: 'asset',
    voicePreset: 'vivian',
    voiceAssetId: 'voice-asset-1',
    timingMode: 'word',
  }), {
    voiceKind: 'preset',
    voicePreset: 'vivian',
  });
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
  ]) {
    for (const [field, item] of states(capabilityId, 'cloud')) {
      if (capabilityId === 'video.generate' && ['serviceTier', 'executionExpiresAfterSec'].includes(field)) {
        assert.deepEqual(item, { field, state: 'disabled', unavailableBecause: 'local-app-surface' });
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
  assert.deepEqual(projectTesterCapabilityParamsForRoute('video.generate', 'local', {
    resolution: '512x288',
    fps: 30,
    cameraFixed: true,
    serviceTier: 'priority',
  }), {
    resolution: '512x288',
    fps: 24,
  });
  assert.deepEqual(projectTesterCapabilityParamsForRoute('video.generate', 'cloud', {
    fps: 30,
    cameraFixed: true,
    serviceTier: 'priority',
  }), {
    fps: 30,
    cameraFixed: true,
  });
  assert.deepEqual(projectTesterCapabilityParamsForRoute('text.generate', 'local', {
    topK: 40,
    stop: ['END'],
  }), {
    topK: 40,
    stop: ['END'],
  });
});
