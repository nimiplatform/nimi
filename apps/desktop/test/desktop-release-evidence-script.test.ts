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
  fs.mkdirSync(path.join(resourcesRoot, 'runtime'), { recursive: true });
  fs.writeFileSync(path.join(resourcesRoot, 'runtime', '.gitkeep'), '\n');
  fs.writeFileSync(path.join(desktopRoot, 'package.json'), JSON.stringify({ version }, null, 2));
  fs.writeFileSync(path.join(tauriRoot, 'tauri.conf.json'), JSON.stringify({
    version,
    bundle: { resources: ['resources/desktop-release-manifest.json'] },
  }, null, 2));
  fs.writeFileSync(path.join(tauriRoot, 'Cargo.toml'), `[package]\nname = "desktop"\nversion = "${version}"\n`);
  fs.writeFileSync(path.join(resourcesRoot, 'desktop-release-manifest.json'), JSON.stringify({
    desktopVersion: version,
    desktopReleaseId: `desktop-${version}+deadbeef`,
    channel: 'stable',
    commit: 'deadbeef',
    builtAt: '2026-03-15T00:00:00Z',
  }, null, 2));

  const artifactDir = path.join(root, 'artifacts');
  fs.mkdirSync(artifactDir, { recursive: true });
  const bundlePath = path.join(artifactDir, 'Nimi_0.1.0_aarch64.dmg.app.tar.gz');
  const signaturePath = `${bundlePath}.sig`;
  const latestJsonPath = path.join(artifactDir, 'latest.json');
  fs.writeFileSync(bundlePath, 'bundle');
  fs.writeFileSync(signaturePath, 'sig');
  fs.writeFileSync(latestJsonPath, JSON.stringify({
    version,
    platforms: {
      'darwin-aarch64': {
        url: 'https://example.com/Nimi_0.1.0_aarch64.dmg.app.tar.gz',
        signature: 'sig',
      },
    },
  }, null, 2));
  return {
    desktopRoot,
    resourcesRoot,
    artifacts: [bundlePath, signaturePath, latestJsonPath],
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
  };
}

test('Desktop release evidence builds a passing Desktop-only summary', () => {
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
    const rendered = renderDesktopReleaseEvidenceMarkdown(evidence);
    assert.match(rendered, /Desktop release id/);
    assert.doesNotMatch(rendered, /Runtime archive/);
  } finally {
    fixture.cleanup();
  }
});

test('Desktop release evidence reports bundled Runtime and updater violations', () => {
  const fixture = makeDesktopEvidenceFixture('0.1.0');
  try {
    fs.writeFileSync(path.join(fixture.resourcesRoot, 'runtime', 'nimi'), 'binary');
    const evidence = buildDesktopReleaseEvidence({
      desktopRoot: fixture.desktopRoot,
      artifactPaths: fixture.artifacts.filter((artifactPath) => !artifactPath.endsWith('.sig')),
      expectedVersion: '0.1.0',
      expectedBundle: 'nsis',
      platform: 'windows-latest',
    });
    assert.equal(evidence.ok, false);
    assert.ok(evidence.releaseSyncViolations.some((line: string) => line.includes('forbidden bundled Runtime payload')));
    assert.ok(evidence.updaterViolations.some((line: string) => line.includes('no updater signature artifacts')));
  } finally {
    fixture.cleanup();
  }
});
