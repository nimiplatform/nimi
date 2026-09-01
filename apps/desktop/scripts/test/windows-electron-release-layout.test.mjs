import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';

import {
  REQUIRED_WINDOWS_ELECTRON_ASAR_ENTRIES,
  WINDOWS_ELECTRON_LAYOUT_DIRECTORY,
  assertNativeWindowsX64,
  assertWindowsElectronAsarInventory,
  assertWindowsX64Pe,
  resolveWindowsElectronLayoutOutput,
  windowsElectronCandidateNotice,
  windowsElectronPackagerOptions,
} from '../lib/windows-electron-release-layout.mjs';

test('Windows Electron layout target and output are exact and deterministic', () => {
  assert.doesNotThrow(() => assertNativeWindowsX64('win32', 'x64'));
  assert.throws(() => assertNativeWindowsX64('win32', 'arm64'), /win32\/arm64/u);
  assert.throws(() => assertNativeWindowsX64('darwin', 'x64'), /darwin\/x64/u);

  const desktopRoot = path.resolve('workspace', 'apps', 'desktop');
  assert.equal(
    resolveWindowsElectronLayoutOutput(desktopRoot),
    path.join(desktopRoot, 'dist', 'windows', WINDOWS_ELECTRON_LAYOUT_DIRECTORY),
  );
});

test('Windows Electron packager configuration is an unpacked local-development x64 app layout', () => {
  const options = windowsElectronPackagerOptions({
    dir: 'source',
    electronVersion: '42.10.1',
    icon: 'favicon.ico',
    out: 'output',
    resource: 'favicon.png',
    version: '0.2.0-preview.1',
  });

  assert.equal(options.platform, 'win32');
  assert.equal(options.arch, 'x64');
  assert.equal(options.prune, false);
  assert.deepEqual(options.asar, { unpack: '**/*.{node,dll}' });
  assert.equal(options.name, 'Nimi');
  assert.equal(options.executableName, 'Nimi');
  assert.equal(options.win32metadata.ProductName, 'Nimi');
  assert.equal(options.win32metadata['requested-execution-level'], 'asInvoker');
  assert.equal('windowsSign' in options, false);
});

test('Windows Electron candidate notice cannot be mistaken for an installer or production signing', () => {
  const notice = windowsElectronCandidateNotice({
    electronVersion: '42.10.1',
    version: '0.2.0-preview.1',
  });
  assert.match(notice, /NON-PRODUCT CANDIDATE/u);
  assert.match(notice, /not an installer or uninstaller/u);
  assert.match(notice, /local-development Authenticode identity only/u);
  assert.match(notice, /not SignPath\/production signed/u);
});

test('Windows Electron ASAR inventory carries the current shell and rejects retired product-control native code', () => {
  const entries = [
    ...REQUIRED_WINDOWS_ELECTRON_ASAR_ENTRIES,
    'node_modules/@img/sharp-win32-x64/lib/libvips-42.dll',
    'node_modules/@img/sharp-win32-x64/lib/sharp-win32-x64-0.35.4.node',
  ];
  const mainSource = [
    '@nimiplatform/kit-protected-local-win32-x64',
    'product_control_record_get',
    'product_control_record_admit_ready_for_use',
  ].join('\n');
  assert.doesNotThrow(() => assertWindowsElectronAsarInventory(
    entries.map((entry) => `\\${entry.replaceAll('/', '\\')}`),
    mainSource,
  ));
  assert.throws(
    () => assertWindowsElectronAsarInventory(entries.slice(1), mainSource),
    /avatar\/dist\/index\.html/u,
  );
  assert.throws(
    () => assertWindowsElectronAsarInventory([
      ...entries,
      'node_modules/@nimiplatform/desktop-product-control-win32-x64/index.cjs',
    ], mainSource),
    /retired product-control native placeholder/u,
  );
});

test('Windows Electron PE validation admits only x64 Windows images', () => {
  const x64 = Buffer.alloc(128);
  x64.writeUInt16LE(0x5a4d, 0);
  x64.writeUInt32LE(64, 0x3c);
  x64.writeUInt32LE(0x00004550, 64);
  x64.writeUInt16LE(0x8664, 68);
  assert.doesNotThrow(() => assertWindowsX64Pe(x64, 'x64 fixture'));

  const arm64 = Buffer.from(x64);
  arm64.writeUInt16LE(0xaa64, 68);
  assert.throws(() => assertWindowsX64Pe(arm64, 'arm64 fixture'), /not an x64 Windows PE image/u);
  assert.throws(() => assertWindowsX64Pe(Buffer.alloc(8), 'short fixture'), /not a Windows PE image/u);
});
