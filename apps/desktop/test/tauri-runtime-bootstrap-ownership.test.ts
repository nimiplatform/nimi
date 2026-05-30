import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const tauriApiSource = readFileSync(
  fileURLToPath(new URL('../src/runtime/tauri-api.ts', import.meta.url)),
  'utf8',
);
const mainSource = readFileSync(
  fileURLToPath(new URL('../src/shell/renderer/main.tsx', import.meta.url)),
  'utf8',
);

// Architecture guard, not a behavior test: the renderer runtime-transport hook
// has exactly one installer — `installNimiShellRuntimeBridge()` in
// `@nimiplatform/kit/shell/renderer/bridge`. Desktop must consume it, never ship a
// parallel `__NIMI_TAURI_RUNTIME__` installer.

test('desktop does not publish a parallel runtime-transport hook installer', () => {
  // No assignment to the hook global anywhere in desktop's tauri-api (reads for
  // consuming the Kit-installed hook are allowed; assignment = a second owner).
  assert.doesNotMatch(tauriApiSource, /__NIMI_TAURI_RUNTIME__\s*=/);
  assert.doesNotMatch(tauriApiSource, /installSdkTauriRuntimeHook/);
});

test('desktop renderer entry installs the Kit-owned runtime bridge', () => {
  assert.match(mainSource, /@nimiplatform\/kit\/shell\/renderer\/bridge/);
  assert.match(mainSource, /installNimiShellRuntimeBridge\(\)/);
  assert.doesNotMatch(mainSource, /installSdkTauriRuntimeHook/);
});
