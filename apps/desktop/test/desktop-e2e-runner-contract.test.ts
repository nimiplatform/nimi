import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const runnerSource = fs.readFileSync(
  path.join(root, 'scripts/run-e2e.mjs'),
  'utf8',
);
const runtimeUnavailableSpecSource = fs.readFileSync(
  path.join(root, 'e2e/specs/boot.runtime-unavailable.degraded-shell.e2e.mjs'),
  'utf8',
);

test('desktop E2E runner resolves native WebDriver command names to executable paths', () => {
  assert.match(runnerSource, /function resolveNativeDriverPath\(nativeDriver\)/);
  assert.match(runnerSource, /os\.platform\(\) === 'win32' \? 'where\.exe' : 'which'/);
  assert.match(runnerSource, /const nativeDriver = resolveNativeDriverPath\(process\.env\.NIMI_E2E_NATIVE_DRIVER\);/);
});

test('desktop E2E runner fails fast when tauri-driver exits before opening the WebDriver port', () => {
  assert.match(runnerSource, /let driverExit = null;/);
  assert.match(runnerSource, /tauri-driver exited before opening/);
  assert.match(runnerSource, /see \$\{path\.join\(artifactsDir, 'tauri-driver\.log'\)\}/);
});

test('runtime-unavailable boot smoke targets the canonical desktop release strip', () => {
  assert.match(runtimeUnavailableSpecSource, /E2E_IDS\.desktopReleaseStrip/);
  assert.doesNotMatch(runtimeUnavailableSpecSource, /E2E_IDS\.offlineStrip/);
});
