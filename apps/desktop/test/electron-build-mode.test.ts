import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  requireFreshPreparedElectronArtifacts,
  requireReusableElectronArtifacts,
  resolveDevKernelElectronBuildMode,
  writeFreshPreparedElectronArtifactBinding,
  writeReusableElectronArtifactBinding,
} from '../scripts/lib/electron-build-mode.mjs';

test('dev-kernel Electron build mode defaults to fresh and admits explicit reuse', () => {
  assert.equal(resolveDevKernelElectronBuildMode({}), 'fresh');
  assert.equal(resolveDevKernelElectronBuildMode({ NIMI_DEV_KERNEL_ELECTRON_BUILD_MODE: ' reuse ' }), 'reuse');
  assert.equal(resolveDevKernelElectronBuildMode({ NIMI_DEV_KERNEL_ELECTRON_BUILD_MODE: 'fresh-prepared' }), 'fresh-prepared');
});

test('dev-kernel Electron build mode rejects aliases and empty reuse artifacts', () => {
  assert.throws(
    () => resolveDevKernelElectronBuildMode({ NIMI_DEV_KERNEL_ELECTRON_BUILD_MODE: 'skip-build' }),
    /must be fresh, fresh-prepared, or reuse/u,
  );
  assert.throws(() => requireReusableElectronArtifacts([]), /non-empty file list/u);
});

test('reusable Electron artifacts require an exact source and content binding', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nimi-electron-binding-test-'));
  try {
    const present = path.join(root, 'main.js');
    const manifestPath = path.join(root, 'binding.json');
    const sourceDigest = 'a'.repeat(64);
    fs.writeFileSync(present, 'export {};\n');
    writeReusableElectronArtifactBinding([present], { manifestPath, repoRoot: root, sourceDigest });
    assert.deepEqual(
      requireReusableElectronArtifacts([present], { manifestPath, repoRoot: root, sourceDigest }),
      [path.resolve(present)],
    );
    assert.throws(
      () => requireReusableElectronArtifacts([present], { manifestPath, repoRoot: root, sourceDigest: 'b'.repeat(64) }),
      /binding is stale/u,
    );
    fs.writeFileSync(present, 'export const drift = true;\n');
    assert.throws(
      () => requireReusableElectronArtifacts([present], { manifestPath, repoRoot: root, sourceDigest }),
      /binding drifted/u,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('fresh-prepared Electron artifacts require exact source, preparation, and content bindings', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nimi-electron-fresh-prepared-test-'));
  try {
    const present = path.join(root, 'main.js');
    const manifestPath = path.join(root, 'binding.json');
    const sourceDigest = 'a'.repeat(64);
    const preparationId = 'b'.repeat(32);
    fs.writeFileSync(present, 'export {};\n');
    const manifest = writeFreshPreparedElectronArtifactBinding([present], {
      manifestPath,
      repoRoot: root,
      sourceDigest,
      preparationId,
    });
    assert.equal(manifest.acceptanceEligible, true);
    assert.deepEqual(requireFreshPreparedElectronArtifacts([present], {
      manifestPath,
      repoRoot: root,
      sourceDigest,
      preparationId,
    }), [path.resolve(present)]);
    assert.throws(() => requireFreshPreparedElectronArtifacts([present], {
      manifestPath,
      repoRoot: root,
      sourceDigest,
      preparationId: 'c'.repeat(32),
    }), /binding is stale/u);
    fs.writeFileSync(present, 'export const drift = true;\n');
    assert.throws(() => requireFreshPreparedElectronArtifacts([present], {
      manifestPath,
      repoRoot: root,
      sourceDigest,
      preparationId,
    }), /binding drifted/u);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('reusable Electron artifacts require real files', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nimi-electron-reuse-test-'));
  try {
    const present = path.join(root, 'main.js');
    fs.writeFileSync(present, 'export {};\n');
    assert.deepEqual(requireReusableElectronArtifacts([present]), [path.resolve(present)]);
    assert.throws(
      () => requireReusableElectronArtifacts([present, path.join(root, 'missing.js')]),
      /artifacts are missing/u,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
