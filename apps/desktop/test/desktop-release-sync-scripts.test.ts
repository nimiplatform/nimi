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
  fs.mkdirSync(path.join(resourcesRoot, 'runtime'), { recursive: true });
  fs.writeFileSync(path.join(resourcesRoot, 'runtime', '.gitkeep'), '\n');
  fs.writeFileSync(path.join(desktopRoot, 'package.json'), JSON.stringify({ version }, null, 2));
  fs.writeFileSync(path.join(tauriRoot, 'tauri.conf.json'), JSON.stringify({
    version,
    bundle: { resources: ['resources/desktop-release-manifest.json'] },
  }, null, 2));
  fs.writeFileSync(path.join(tauriRoot, 'Cargo.toml'), `[package]\nname = "desktop"\nversion = "${version}"\n`);
  const manifest = {
    desktopVersion: version,
    desktopReleaseId: `desktop-${version}+deadbeef`,
    channel: 'stable',
    commit: 'deadbeef',
    builtAt: '2026-03-15T00:00:00Z',
  };
  fs.writeFileSync(path.join(resourcesRoot, 'desktop-release-manifest.json'), JSON.stringify(manifest, null, 2));
  return {
    desktopRoot,
    manifestPath: path.join(resourcesRoot, 'desktop-release-manifest.json'),
    runtimeRoot: path.join(resourcesRoot, 'runtime'),
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
  };
}

test('static version sync only checks static version sources', () => {
  const fixture = makeDesktopFixture('1.2.3');
  try {
    assert.deepEqual(collectStaticVersionSyncViolations(fixture.desktopRoot, '1.2.3'), []);
  } finally {
    fixture.cleanup();
  }
});

test('Desktop release sync accepts Desktop-only metadata', () => {
  const fixture = makeDesktopFixture('1.2.3');
  try {
    assert.deepEqual(collectDesktopReleaseSyncViolations(fixture.desktopRoot, '1.2.3'), []);
  } finally {
    fixture.cleanup();
  }
});

test('Desktop release sync rejects Runtime truth in the manifest', () => {
  const fixture = makeDesktopFixture('1.2.3');
  try {
    const manifest = JSON.parse(fs.readFileSync(fixture.manifestPath, 'utf8'));
    manifest.runtimeArchivePath = 'runtime/nimi.zip';
    fs.writeFileSync(fixture.manifestPath, JSON.stringify(manifest, null, 2));
    const violations = collectDesktopReleaseSyncViolations(fixture.desktopRoot, '1.2.3');
    assert.ok(violations.some((line: string) => line.includes('forbidden runtimeArchivePath')));
  } finally {
    fixture.cleanup();
  }
});

test('Desktop release sync rejects bundled Runtime payloads', () => {
  const fixture = makeDesktopFixture('1.2.3');
  try {
    fs.writeFileSync(path.join(fixture.runtimeRoot, 'nimi'), 'binary');
    const violations = collectDesktopReleaseSyncViolations(fixture.desktopRoot, '1.2.3');
    assert.ok(violations.some((line: string) => line.includes('forbidden bundled Runtime payload')));
  } finally {
    fixture.cleanup();
  }
});
