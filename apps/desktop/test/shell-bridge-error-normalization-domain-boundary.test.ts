import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const root = resolve(import.meta.dirname, '../../..');

function read(path: string): string {
  return readFileSync(resolve(root, path), 'utf8');
}

test('shell bridge structured error normalization is Kit-owned with Desktop and Tester consumers', () => {
  const desktopInvoke = read('apps/desktop/src/shell/renderer/bridge/runtime-bridge/invoke.ts');
  const testerTauri = read('apps/tester/src/tester/tester-tauri.ts');
  const kitBridgeIndex = read('kit/shell/renderer/src/bridge/index.ts');
  const kitNimiError = read('kit/shell/renderer/src/bridge/nimi-error.ts');

  assert.match(kitBridgeIndex, /toShellBridgeNimiError/);
  assert.match(kitNimiError, /parseShellBridgeJsonPayload/);
  assert.match(kitNimiError, /getRuntimeReasonCodeMessage/);
  assert.match(kitNimiError, /DESKTOP_HTTP_METHOD_INVALID/);
  assert.match(kitNimiError, /LOCAL_LIFECYCLE_WRITE_DENIED/);

  assert.match(desktopInvoke, /from '@nimiplatform\/kit\/shell\/renderer\/bridge'/);
  assert.match(desktopInvoke, /toShellBridgeNimiError/);
  assert.match(desktopInvoke, /getShellBridgeUserMessageProjection/);
  assert.doesNotMatch(desktopInvoke, /const BRIDGE_ERROR_CODE_MAP/);
  assert.doesNotMatch(desktopInvoke, /function parseBridgeJsonPayload/);
  assert.doesNotMatch(desktopInvoke, /function extractBridgeErrorCode/);

  assert.match(testerTauri, /from '@nimiplatform\/kit\/shell\/renderer\/bridge'/);
  assert.match(testerTauri, /toShellBridgeNimiError/);
  assert.doesNotMatch(testerTauri, /@renderer\//);
  assert.doesNotMatch(testerTauri, /@runtime\//);
});
