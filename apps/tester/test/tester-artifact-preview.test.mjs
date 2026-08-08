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

const { hasStudioArtifactMedia, studioArtifactRenderBranch } = await import(
  pathToFileURL(path.join(buildDir, 'artifact-preview.mjs')).href
);

test.after(async () => {
  await rm(buildDir, { recursive: true, force: true });
});

test('artifact preview projection selects image, video, and audio controls', () => {
  const cases = [
    ['image', { mimeType: 'image/png', url: 'data:image/png;base64,AQ==', previewSource: 'inline-bytes' }],
    ['video', { mimeType: 'video/mp4', url: 'nimi-artifact://video/1', previewSource: 'hosted-uri' }],
    ['audio', { mimeType: 'audio/mpeg', url: 'data:audio/mpeg;base64,AQ==', previewSource: 'inline-bytes' }],
  ];
  for (const [branch, artifact] of cases) {
    assert.equal(studioArtifactRenderBranch(artifact), branch);
    assert.equal(hasStudioArtifactMedia(artifact), true);
  }
});

test('artifact preview projection keeps metadata-only and unsupported artifacts explicit', () => {
  assert.equal(studioArtifactRenderBranch({
    artifactId: 'artifact-video-1',
    mimeType: 'video/mp4',
    previewSource: 'metadata-only',
  }), 'metadata-only');
  assert.equal(studioArtifactRenderBranch({
    mimeType: 'application/octet-stream',
    url: 'https://example.test/artifact.bin',
    previewSource: 'hosted-uri',
  }), 'unsupported');
  assert.equal(studioArtifactRenderBranch(undefined), 'none');
});

test('legacy persisted URL/MIME pairs remain previewable without previewSource', () => {
  assert.equal(studioArtifactRenderBranch({
    mimeType: 'video/mp4',
    url: 'https://example.test/video.mp4',
  }), 'video');
});
