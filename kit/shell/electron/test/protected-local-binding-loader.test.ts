import assert from 'node:assert/strict';
import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'vitest';

import { resolveNimiElectronProtectedLocalPackageSpecifier } from '../src/main/protected-local-binding-loader';

const darwinPackage = '@nimiplatform/kit-protected-local-darwin-arm64';
const windowsPackage = '@nimiplatform/kit-protected-local-win32-x64';

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

const macOSTest = process.platform === 'darwin' ? test : test.skip;
const windowsTest = process.platform === 'win32' ? test : test.skip;

test('Windows D2 installed hosts use the packaged binding and reject workspace overrides', () => {
  const installedHost = {
    architecture: 'x64',
    platform: 'win32',
    sourceDefaultApp: false,
    sourceSourceLocalDevelopment: '1',
  };
  assert.equal(resolveNimiElectronProtectedLocalPackageSpecifier(windowsPackage, installedHost), windowsPackage);
  for (const invalid of [
    { ...installedHost, sourceEntry: 'D:/nimi/kit/shell/protected-local-node/npm/win32-x64/index.cjs' },
    { ...installedHost, sourceSourceLocalDevelopment: '0' },
    { ...installedHost, architecture: 'arm64' },
  ]) {
    assert.throws(() => resolveNimiElectronProtectedLocalPackageSpecifier(windowsPackage, invalid), /protected-carrier-required/u);
  }
  assert.throws(() => resolveNimiElectronProtectedLocalPackageSpecifier(darwinPackage, installedHost), /protected-carrier-required/u);
});

macOSTest('source macOS D2 requires an explicit default-App carrier path', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'nimi-electron-native-source-'));
  try {
    const canonicalRoot = await realpath(root);
    const carrier = path.join(
      canonicalRoot,
      'kit',
      'shell',
      'protected-local-node',
      'npm',
      'darwin-arm64',
    );
    await mkdir(carrier, { recursive: true });
    const entry = path.join(carrier, 'index.cjs');
    await writeFile(entry, 'module.exports = {};\n');
    await writeFile(path.join(carrier, 'nimi_shell_protected_local.node'), 'fixture');
    assert.equal(resolveNimiElectronProtectedLocalPackageSpecifier(darwinPackage, {
      architecture: 'arm64',
      platform: 'darwin',
      sourceDefaultApp: true,
      sourceSourceLocalDevelopment: '1',
      sourceEntry: entry,
    }), entry);
    assert.throws(() => resolveNimiElectronProtectedLocalPackageSpecifier(darwinPackage, {
      architecture: 'arm64',
      platform: 'darwin',
      sourceDefaultApp: false,
      sourceSourceLocalDevelopment: '1',
      sourceEntry: entry,
    }), /protected-carrier-required/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

windowsTest('source Windows D2 requires the explicit workspace carrier path', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'nimi-electron-native-windows-source-'));
  try {
    const canonicalRoot = await realpath(root);
    const carrier = path.join(
      canonicalRoot,
      'kit',
      'shell',
      'protected-local-node',
      'npm',
      'win32-x64',
    );
    await mkdir(carrier, { recursive: true });
    const entry = path.join(carrier, 'index.cjs');
    await writeFile(entry, 'module.exports = {};\n');
    await writeFile(path.join(carrier, 'nimi_shell_protected_local.node'), 'fixture');
    assert.equal(resolveNimiElectronProtectedLocalPackageSpecifier(windowsPackage, {
      architecture: 'x64',
      platform: 'win32',
      sourceDefaultApp: true,
      sourceSourceLocalDevelopment: '1',
      sourceEntry: entry,
    }), entry);
    assert.throws(() => resolveNimiElectronProtectedLocalPackageSpecifier(windowsPackage, {
      architecture: 'x64',
      platform: 'win32',
      sourceDefaultApp: true,
      sourceSourceLocalDevelopment: '0',
      sourceEntry: entry,
    }), /protected-carrier-required/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

macOSTest('packaged macOS Electron rejects a replaced native carrier image', async () => {
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
