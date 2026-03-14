import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  collectDesktopReleaseSyncViolations,
  collectStaticVersionSyncViolations,
} from '../scripts/lib/desktop-release-sync.mjs';

function makeDesktopFixture(version: string) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nimi-desktop-sync-'));
  const desktopRoot = path.join(root, 'apps', 'desktop');
  const tauriRoot = path.join(desktopRoot, 'src-tauri');
  const resourcesRoot = path.join(tauriRoot, 'resources');
  const runtimeResourcesRoot = path.join(resourcesRoot, 'runtime');
  const platformDir = path.join(runtimeResourcesRoot, 'darwin-arm64');

  fs.mkdirSync(platformDir, { recursive: true });
  fs.writeFileSync(path.join(desktopRoot, 'package.json'), JSON.stringify({ version }, null, 2));
  fs.writeFileSync(path.join(tauriRoot, 'tauri.conf.json'), JSON.stringify({ version }, null, 2));
  fs.writeFileSync(path.join(tauriRoot, 'Cargo.toml'), `[package]\nname = "desktop"\nversion = "${version}"\n`);

  const runtimeManifest = {
    version,
    platform: 'darwin-arm64',
    archivePath: 'runtime/darwin-arm64/nimi-runtime.zip',
    binaryPath: 'bin/nimi',
    sha256: 'abc123',
    builtAt: '2026-03-15T00:00:00Z',
    commit: 'deadbeef',
  };
  const releaseManifest = {
    desktopVersion: version,
    runtimeVersion: version,
    channel: 'stable',
    commit: 'deadbeef',
    runtimeArchivePath: runtimeManifest.archivePath,
    runtimeSha256: runtimeManifest.sha256,
    runtimeBinaryPath: runtimeManifest.binaryPath,
    builtAt: runtimeManifest.builtAt,
  };

  fs.writeFileSync(path.join(resourcesRoot, 'desktop-release-manifest.json'), JSON.stringify(releaseManifest, null, 2));
  fs.writeFileSync(path.join(runtimeResourcesRoot, 'manifest.json'), JSON.stringify(runtimeManifest, null, 2));
  fs.writeFileSync(path.join(platformDir, 'manifest.json'), JSON.stringify(runtimeManifest, null, 2));
  fs.writeFileSync(path.join(resourcesRoot, runtimeManifest.archivePath), 'zip');

  return { desktopRoot, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}

test('static version sync only checks static version sources', () => {
  const fixture = makeDesktopFixture('1.2.3');
  try {
    assert.deepEqual(collectStaticVersionSyncViolations(fixture.desktopRoot, '1.2.3'), []);
  } finally {
    fixture.cleanup();
  }
});

test('desktop release sync fails on generated manifest drift', () => {
  const fixture = makeDesktopFixture('1.2.3');
  try {
    const runtimeManifestPath = path.join(
      fixture.desktopRoot,
      'src-tauri',
      'resources',
      'runtime',
      'manifest.json',
    );
    const current = JSON.parse(fs.readFileSync(runtimeManifestPath, 'utf8'));
    current.sha256 = 'def456';
    fs.writeFileSync(runtimeManifestPath, JSON.stringify(current, null, 2));

    const violations = collectDesktopReleaseSyncViolations(fixture.desktopRoot, '1.2.3');
    assert.ok(violations.some((line) => line.includes('sha256 mismatch')));
  } finally {
    fixture.cleanup();
  }
});
