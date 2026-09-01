import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  createReleaseManifest,
  verifyReleaseManifest,
  verifyStablePromotion,
} from './release-artifact-manifest.mjs';

function tempDirectory(name) {
  return mkdtempSync(path.join(tmpdir(), `${name}-`));
}

test('create and verify bind flat release artifacts to component, version, and commit', () => {
  const root = tempDirectory('nimi-release-manifest');
  const artifactsDir = path.join(root, 'artifacts');
  mkdirSync(artifactsDir);
  writeFileSync(path.join(artifactsDir, 'sdk.tgz'), 'sdk payload');
  writeFileSync(path.join(artifactsDir, 'sdk.spdx.json'), '{}\n');
  const manifestPath = path.join(artifactsDir, 'release-manifest.json');

  const { manifest } = createReleaseManifest({
    component: 'sdk',
    version: '0.7.0',
    commit: 'a'.repeat(40),
    channel: 'canary',
    artifactsDir,
    outputPath: manifestPath,
  });
  assert.deepEqual(manifest.artifacts.map((artifact) => artifact.name), ['sdk.spdx.json', 'sdk.tgz']);
  assert.equal(JSON.parse(readFileSync(manifestPath, 'utf8')).commit, 'a'.repeat(40));
  assert.equal(
    verifyReleaseManifest({
      manifestPath,
      artifactsDir,
      component: 'sdk',
      version: '0.7.0',
      commit: 'a'.repeat(40),
      channel: 'canary',
    }).component,
    'sdk',
  );

  writeFileSync(path.join(artifactsDir, 'sdk.tgz'), 'changed payload');
  assert.throws(
    () => verifyReleaseManifest({ manifestPath, artifactsDir }),
    /do not exactly match/,
  );
});

test('manifest creation rejects prerelease output versions and nested artifact directories', () => {
  const root = tempDirectory('nimi-release-shape');
  const artifactsDir = path.join(root, 'artifacts');
  mkdirSync(path.join(artifactsDir, 'nested'), { recursive: true });
  writeFileSync(path.join(artifactsDir, 'payload.tgz'), 'payload');

  assert.throws(
    () => createReleaseManifest({
      component: 'sdk',
      version: '0.7.0-rc.1',
      commit: 'a'.repeat(40),
      channel: 'canary',
      artifactsDir,
    }),
    /exact stable semver/,
  );
  assert.throws(
    () => createReleaseManifest({
      component: 'sdk',
      version: '0.7.0',
      commit: 'a'.repeat(40),
      channel: 'canary',
      artifactsDir,
    }),
    /must be flat/,
  );
});

test('promotion keeps global release-train tags independent from component versions', () => {
  const repoRoot = tempDirectory('nimi-release-promotion');
  execFileSync('git', ['init', '-q'], { cwd: repoRoot });
  execFileSync('git', ['config', 'user.email', 'release-test@example.com'], { cwd: repoRoot });
  execFileSync('git', ['config', 'user.name', 'Release Test'], { cwd: repoRoot });
  writeFileSync(path.join(repoRoot, 'source.txt'), 'candidate\n');
  execFileSync('git', ['add', 'source.txt'], { cwd: repoRoot });
  execFileSync('git', ['commit', '-qm', 'candidate'], { cwd: repoRoot });
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim();
  execFileSync('git', ['tag', 'v0.1.0-rc.1'], { cwd: repoRoot });
  execFileSync('git', ['tag', 'v0.1.0'], { cwd: repoRoot });

  const artifactsDir = path.join(repoRoot, 'artifacts');
  mkdirSync(artifactsDir);
  writeFileSync(path.join(artifactsDir, 'nimiplatform-sdk-0.7.0.tgz'), 'payload');
  const manifestPath = path.join(artifactsDir, 'release-manifest.json');
  createReleaseManifest({
    component: 'sdk',
    version: '0.7.0',
    commit,
    channel: 'rc',
    releaseTag: 'v0.1.0-rc.1',
    artifactsDir,
    outputPath: manifestPath,
  });

  assert.equal(
    verifyStablePromotion({
      manifestPath,
      artifactsDir,
      rcTag: 'v0.1.0-rc.1',
      stableTag: 'v0.1.0',
      repoRoot,
    }).commit,
    commit,
  );

  writeFileSync(path.join(repoRoot, 'source.txt'), 'different\n');
  execFileSync('git', ['add', 'source.txt'], { cwd: repoRoot });
  execFileSync('git', ['commit', '-qm', 'different'], { cwd: repoRoot });
  execFileSync('git', ['tag', 'v0.1.1'], { cwd: repoRoot });
  assert.throws(
    () => verifyStablePromotion({
      manifestPath,
      artifactsDir,
      rcTag: 'v0.1.0-rc.1',
      stableTag: 'v0.1.1',
      repoRoot,
    }),
    /stable tag must be exactly/,
  );
});
