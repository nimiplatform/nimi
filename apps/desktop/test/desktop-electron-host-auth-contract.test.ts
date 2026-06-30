import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const mainSource = readFileSync(
  new URL('../src-electron/main.ts', import.meta.url),
  'utf8',
);
const authSource = readFileSync(
  new URL('../src-electron/runtime-auth.ts', import.meta.url),
  'utf8',
);

test('Desktop Electron main wires host-owned Runtime auth metadata', () => {
  assert.match(mainSource, /createDesktopElectronTrustedRuntimeMetadataProvider/);
  assert.match(mainSource, /trustedRuntimeMetadataProvider:\s*createDesktopElectronTrustedRuntimeMetadataProvider/);
  assert.match(authSource, /createNimiElectronRuntimeAccountTrustedMetadataProvider/);
  assert.match(authSource, /createNimiDesktopShellRuntimeAccountCaller/);
  assert.match(authSource, /appSession:\s*\{/);
  assert.match(authSource, /protectedAccess:\s*\{/);
  assert.match(authSource, /isDesktopRuntimeLocalProductControlMethodId/);
  assert.doesNotMatch(authSource, /createNimiDeveloperRegisteredRuntimeAccountCaller/);
  assert.doesNotMatch(authSource, /developerRegistration:\s*true/);
  assert.doesNotMatch(authSource, /\bwindow\b|\bdocument\b/);
});
