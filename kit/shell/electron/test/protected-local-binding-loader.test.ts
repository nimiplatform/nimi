import assert from 'node:assert/strict';
import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'vitest';

import { resolveNimiElectronProtectedLocalPackageSpecifier } from '../src/main/protected-local-binding-loader';

const darwinPackage = '@nimiplatform/kit-protected-local-darwin-arm64';

test('packaged macOS Electron resolves only its sealed native carrier resource', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'nimi-electron-native-carrier-'));
  try {
    let resources = path.join(root, 'Nimi.app', 'Contents', 'Resources');
    let carrier = path.join(resources, 'nimi-native', 'protected-local');
    await mkdir(carrier, { recursive: true });
    resources = await realpath(resources);
    carrier = path.join(resources, 'nimi-native', 'protected-local');
    await writeFile(path.join(carrier, 'index.cjs'), 'module.exports = {};\n');
    await writeFile(path.join(carrier, 'nimi_shell_protected_local.node'), 'fixture');
    assert.equal(resolveNimiElectronProtectedLocalPackageSpecifier(darwinPackage, {
      architecture: 'arm64',
      platform: 'darwin',
      resourcesPath: resources,
    }), path.join(carrier, 'index.cjs'));
    assert.equal(resolveNimiElectronProtectedLocalPackageSpecifier(
      '@nimiplatform/kit-protected-local-win32-x64',
      { architecture: 'x64', platform: 'win32' },
    ), '@nimiplatform/kit-protected-local-win32-x64');
    assert.throws(() => resolveNimiElectronProtectedLocalPackageSpecifier(
      '@nimiplatform/kit-protected-local-win32-x64',
      { architecture: 'arm64', platform: 'darwin', resourcesPath: resources },
    ), /protected-carrier-required/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('packaged macOS Electron rejects a replaced native carrier image', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'nimi-electron-native-carrier-link-'));
  try {
    let resources = path.join(root, 'Nimi.app', 'Contents', 'Resources');
    let carrier = path.join(resources, 'nimi-native', 'protected-local');
    const replacement = path.join(root, 'replacement.node');
    await mkdir(carrier, { recursive: true });
    resources = await realpath(resources);
    carrier = path.join(resources, 'nimi-native', 'protected-local');
    await writeFile(path.join(carrier, 'index.cjs'), 'module.exports = {};\n');
    await writeFile(replacement, 'fixture');
    await symlink(replacement, path.join(carrier, 'nimi_shell_protected_local.node'));
    assert.throws(() => resolveNimiElectronProtectedLocalPackageSpecifier(darwinPackage, {
      architecture: 'arm64',
      platform: 'darwin',
      resourcesPath: resources,
    }), /protected-carrier-required/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
