import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createDesktopReleaseManifest,
  createRuntimeManifest,
  runtimeBinaryName,
} from '../scripts/prepare-runtime-bundle.mjs';

test('prepare-runtime-bundle emits aligned runtime and desktop release manifests', () => {
  const binaryPath = `bin/${runtimeBinaryName()}`;
  const runtimeManifest = createRuntimeManifest({
    version: '2.0.0',
    platform: 'darwin-arm64',
    archivePath: 'runtime/darwin-arm64/nimi-runtime.zip',
    binaryPath,
    sha256: 'abc123',
    builtAt: '2026-03-15T00:00:00Z',
    commit: 'deadbeef',
  });
  const releaseManifest = createDesktopReleaseManifest({
    version: '2.0.0',
    channel: 'stable',
    commit: 'deadbeef',
    runtimeArchivePath: runtimeManifest.archivePath,
    runtimeSha256: runtimeManifest.sha256,
    runtimeBinaryPath: runtimeManifest.binaryPath,
    builtAt: runtimeManifest.builtAt,
  });

  assert.equal(runtimeManifest.version, releaseManifest.desktopVersion);
  assert.equal(runtimeManifest.version, releaseManifest.runtimeVersion);
  assert.equal(runtimeManifest.archivePath, releaseManifest.runtimeArchivePath);
  assert.equal(runtimeManifest.sha256, releaseManifest.runtimeSha256);
  assert.equal(runtimeManifest.binaryPath, releaseManifest.runtimeBinaryPath);
});
