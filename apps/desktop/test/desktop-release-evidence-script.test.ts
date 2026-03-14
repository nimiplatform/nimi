import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  buildDesktopReleaseEvidence,
  renderDesktopReleaseEvidenceMarkdown,
} from '../scripts/lib/desktop-release-evidence.mjs';

function makeDesktopEvidenceFixture(version: string) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nimi-desktop-evidence-'));
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

  fs.mkdirSync(path.join(resourcesRoot, 'runtime', 'darwin-arm64'), { recursive: true });
  fs.writeFileSync(path.join(resourcesRoot, 'desktop-release-manifest.json'), JSON.stringify(releaseManifest, null, 2));
  fs.writeFileSync(path.join(runtimeResourcesRoot, 'manifest.json'), JSON.stringify(runtimeManifest, null, 2));
  fs.writeFileSync(path.join(platformDir, 'manifest.json'), JSON.stringify(runtimeManifest, null, 2));
  fs.writeFileSync(path.join(resourcesRoot, runtimeManifest.archivePath), 'zip');

  const artifactDir = path.join(root, 'artifacts');
  fs.mkdirSync(artifactDir, { recursive: true });
  const bundlePath = path.join(artifactDir, 'Nimi_0.1.0_aarch64.dmg.app.tar.gz');
  const signaturePath = `${bundlePath}.sig`;
  const latestJsonPath = path.join(artifactDir, 'latest.json');
  fs.writeFileSync(bundlePath, 'bundle');
  fs.writeFileSync(signaturePath, 'sig');
  fs.writeFileSync(
    latestJsonPath,
    `${JSON.stringify({
      version,
      platforms: {
        'darwin-aarch64': {
          url: 'https://example.com/Nimi_0.1.0_aarch64.dmg.app.tar.gz',
          signature: 'sig',
        },
      },
    }, null, 2)}\n`,
  );

  return {
    desktopRoot,
    artifacts: [bundlePath, signaturePath, latestJsonPath],
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
  };
}

test('desktop release evidence builds a passing summary for aligned artifacts', () => {
  const fixture = makeDesktopEvidenceFixture('0.1.0');
  try {
    const evidence = buildDesktopReleaseEvidence({
      desktopRoot: fixture.desktopRoot,
      artifactPaths: fixture.artifacts,
      expectedVersion: '0.1.0',
      expectedBundle: 'app',
      platform: 'macos-latest',
      workflowRef: 'desktop-release-dry-run',
      commit: 'deadbeef',
    });

    assert.equal(evidence.ok, true);
    assert.equal(evidence.signatureArtifactCount, 1);
    assert.match(renderDesktopReleaseEvidenceMarkdown(evidence), /Verdict: PASS/);
  } finally {
    fixture.cleanup();
  }
});

test('desktop release evidence reports updater and release-sync violations', () => {
  const fixture = makeDesktopEvidenceFixture('0.1.0');
  try {
    fs.writeFileSync(
      path.join(fixture.desktopRoot, 'src-tauri', 'resources', 'runtime', 'manifest.json'),
      `${JSON.stringify({
        version: '0.1.0',
        platform: 'darwin-arm64',
        archivePath: 'runtime/darwin-arm64/nimi-runtime.zip',
        binaryPath: 'bin/nimi',
        sha256: 'wrong',
        builtAt: '2026-03-15T00:00:00Z',
        commit: 'deadbeef',
      }, null, 2)}\n`,
    );

    const evidence = buildDesktopReleaseEvidence({
      desktopRoot: fixture.desktopRoot,
      artifactPaths: fixture.artifacts.filter((artifactPath) => !artifactPath.endsWith('.sig')),
      expectedVersion: '0.1.0',
      expectedBundle: 'nsis',
      platform: 'windows-latest',
    });

    assert.equal(evidence.ok, false);
    assert.ok(evidence.releaseSyncViolations.some((line) => line.includes('sha256 mismatch')));
    assert.ok(evidence.updaterViolations.some((line) => line.includes('no updater signature artifacts')));
  } finally {
    fixture.cleanup();
  }
});
