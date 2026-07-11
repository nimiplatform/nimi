import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

test('Electron main has no installed child launch IPC before A.1', () => {
  const mainSource = readFileSync(new URL('../src-electron/main.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(mainSource, /registerDesktopInstalledAppLaunchIpc/);
  assert.doesNotMatch(mainSource, /DESKTOP_INSTALLED_APP_LAUNCH_COMMAND/);
  assert.doesNotMatch(mainSource, /DESKTOP_INSTALLED_APP_PROTOCOL_SCHEME/);
  assert.doesNotMatch(mainSource, /createDesktopInstalledAppLauncher/);
  assert.match(mainSource, /protocol\.registerSchemesAsPrivileged/);
  assert.match(mainSource, /NIMI_ELECTRON_SHELL_FILE_PROTOCOL_REGISTRATION/);
  assert.doesNotMatch(mainSource, /localAssetProtocolHost\.registerPrivilegedSchemes/);
  assert.equal(mainSource.match(/protocol\.registerSchemesAsPrivileged\(/g)?.length, 1);
});
