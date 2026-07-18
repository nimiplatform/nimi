import assert from 'node:assert/strict';
import test from 'node:test';

import { createDesktopReleaseManifest } from '../scripts/prepare-desktop-release-metadata.mjs';

test('Desktop release metadata contains no Runtime install or staging truth', () => {
  const manifest = createDesktopReleaseManifest({
    version: '2.0.0',
    releaseId: 'desktop-2.0.0+deadbeef',
    channel: 'stable',
    commit: 'deadbeef',
    builtAt: '2026-03-15T00:00:00Z',
  });

  assert.deepEqual(Object.keys(manifest).sort(), [
    'builtAt',
    'channel',
    'commit',
    'desktopReleaseId',
    'desktopVersion',
  ]);
  assert.equal(manifest.desktopVersion, '2.0.0');
  assert.equal(manifest.desktopReleaseId, 'desktop-2.0.0+deadbeef');
  assert.equal('runtimeVersion' in manifest, false);
  assert.equal('runtimeArchivePath' in manifest, false);
});

test('Desktop release metadata rejects path-like release ids', () => {
  assert.throws(() => createDesktopReleaseManifest({
    version: '2.0.0',
    releaseId: '../runtime',
    channel: 'stable',
    commit: 'deadbeef',
    builtAt: '2026-03-15T00:00:00Z',
  }), /desktopReleaseId/);
});
