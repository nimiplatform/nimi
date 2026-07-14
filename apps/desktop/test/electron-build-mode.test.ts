import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  requireReusableElectronArtifacts,
  resolveDevKernelElectronBuildMode,
} from '../scripts/lib/electron-build-mode.mjs';

test('dev-kernel Electron build mode defaults to fresh and admits explicit reuse', () => {
  assert.equal(resolveDevKernelElectronBuildMode({}), 'fresh');
  assert.equal(resolveDevKernelElectronBuildMode({ NIMI_DEV_KERNEL_ELECTRON_BUILD_MODE: ' reuse ' }), 'reuse');
});

test('dev-kernel Electron build mode rejects aliases and empty reuse artifacts', () => {
  assert.throws(
    () => resolveDevKernelElectronBuildMode({ NIMI_DEV_KERNEL_ELECTRON_BUILD_MODE: 'skip-build' }),
    /must be fresh or reuse/u,
  );
  assert.throws(() => requireReusableElectronArtifacts([]), /non-empty file list/u);
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
