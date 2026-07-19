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

test('Desktop Open raises and focuses the real Desktop window before intent delivery', () => {
  assert.match(mainSource, /window\.show\(\);\s*window\.moveTop\(\);\s*window\.focus\(\);/u);
  assert.match(mainSource, /focusMainWindow: focusDesktopMainWindow/u);
  assert.match(mainSource, /emitIntent: emitDesktopOpenIntent/u);
});
