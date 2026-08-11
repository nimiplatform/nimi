import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { build } from 'esbuild';

const root = path.resolve(import.meta.dirname, '..');
const buildDir = mkdtempSync(path.join(tmpdir(), 'nimi-tester-artifact-preview-'));

await build({
  entryPoints: [path.join(root, 'src/tester/workbench/section-ai-testing-artifact-preview.ts')],
  outfile: path.join(buildDir, 'artifact-preview.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'es2022',
  sourcemap: false,
  logLevel: 'silent',
});

const { STUDIO_ARTIFACT_IMAGE_LOADING, hasStudioArtifactMedia, studioArtifactRenderBranch } = await import(
  pathToFileURL(path.join(buildDir, 'artifact-preview.mjs')).href
);

test.after(async () => {
  await rm(buildDir, { recursive: true, force: true });
});

test('artifact preview projection selects image, video, and audio controls', () => {
  const cases = [
    ['image', { mediaType: 'image/png', relativePath: 'media/image.asset', previewSource: 'managed-asset' }],
    ['video', { mediaType: 'video/mp4', relativePath: 'media/video.asset', previewSource: 'managed-asset' }],
    ['audio', { mediaType: 'audio/mpeg', relativePath: 'media/audio.asset', previewSource: 'managed-asset' }],
  ];
  for (const [branch, artifact] of cases) {
    assert.equal(studioArtifactRenderBranch(artifact), branch);
    assert.equal(hasStudioArtifactMedia(artifact), true);
  }
});

test('managed image previews start decoding without native lazy-load deferral', () => {
  assert.equal(STUDIO_ARTIFACT_IMAGE_LOADING, 'eager');
});

test('artifact preview projection keeps metadata-only and unsupported artifacts explicit', () => {
  assert.equal(studioArtifactRenderBranch({
    mediaType: 'video/mp4',
  }), 'metadata-only');
  assert.equal(studioArtifactRenderBranch({
    mediaType: 'application/octet-stream',
    relativePath: 'media/binary.asset',
    previewSource: 'managed-asset',
  }), 'unsupported');
  assert.equal(studioArtifactRenderBranch(undefined), 'none');
});

test('legacy persisted URL/MIME pairs are hard-cut from managed playback', () => {
  assert.equal(studioArtifactRenderBranch({
    mimeType: 'video/mp4',
    url: 'https://example.test/video.mp4',
  }), 'metadata-only');
});
