import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const mainSource = readFileSync(
  new URL('../src-electron/main.ts', import.meta.url),
  'utf8',
);
test('Desktop Electron main keeps account authority on the protected Desktop host', () => {
  assert.doesNotMatch(mainSource, /trustedRuntimeMetadataProvider|createDesktopElectronTrustedRuntimeMetadataProvider/);
  assert.match(mainSource, /createDesktopElectronProductControlHost/);
  assert.match(mainSource, /productControlHost\.commandHandlers/);
});
