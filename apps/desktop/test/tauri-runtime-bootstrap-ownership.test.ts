import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const desktopTauriApiPath = fileURLToPath(new URL('../src/runtime/tauri-api.ts', import.meta.url));
const mainSource = readFileSync(
  fileURLToPath(new URL('../src/shell/renderer/main.tsx', import.meta.url)),
  'utf8',
);
const kitBridgeSource = readFileSync(
  fileURLToPath(new URL('../../../kit/shell/renderer/src/bridge/index.ts', import.meta.url)),
  'utf8',
);
const kitBootstrapSource = readFileSync(
  fileURLToPath(new URL('../../../kit/shell/renderer/src/bootstrap/index.ts', import.meta.url)),
  'utf8',
);

// Architecture guard, not a behavior test: the renderer runtime-transport hook
// has exactly one installer — `installNimiShellRuntimeBridge()` in
// Kit's shell renderer boundary. Desktop consumes the Kit bootstrap readiness
// helper; Kit bootstrap owns the retry policy and delegates to the bridge
// installer instead of letting Desktop publish a parallel `__NIMI_TAURI_RUNTIME__`
// installer.

test('desktop does not publish a parallel runtime-transport hook installer', () => {
  assert.equal(existsSync(desktopTauriApiPath), false);
});

test('desktop renderer entry installs the Kit-owned runtime bridge', () => {
  assert.match(mainSource, /@nimiplatform\/kit\/shell\/renderer\/bootstrap/);
  assert.match(mainSource, /ensureNimiShellRuntimeBridgeInstalled\(/);
  assert.doesNotMatch(mainSource, /installNimiShellRuntimeBridge\(\);/);
  assert.doesNotMatch(mainSource, /installSdkTauriRuntimeHook/);
});

test('Kit bootstrap delegates to the bridge-owned runtime installer', () => {
  assert.match(kitBridgeSource, /export \{ installNimiShellRuntimeBridge \} from '\.\.\/bootstrap\/runtime-bridge\.js'/);
  assert.match(kitBootstrapSource, /import \{ installNimiShellRuntimeBridge \} from '\.\/runtime-bridge\.js'/);
  assert.match(kitBootstrapSource, /const install = options\.install \|\| installNimiShellRuntimeBridge/);
});
