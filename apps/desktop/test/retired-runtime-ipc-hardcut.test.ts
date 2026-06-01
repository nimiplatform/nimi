import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = process.cwd();

function sourceAt(...segments: string[]) {
  return readFileSync(path.resolve(root, ...segments), 'utf-8');
}

test('retired runtime Tauri store bridge stays physically absent', () => {
  assert.equal(
    existsSync(path.resolve(root, 'src/runtime/runtime-store/tauri-bridge.ts')),
    false,
  );
  assert.equal(
    existsSync(path.resolve(root, 'src/runtime/llm-adapter/tauri-bridge.ts')),
    false,
  );
});

test('desktop runtime bridge no longer exposes retired Tauri wrappers', () => {
  const checkedSources = [
    'src/shell/renderer/bridge/runtime-bridge/local-runtime-os-helpers.ts',
    'src/shell/renderer/bridge/runtime-bridge/runtime-parsers.ts',
    'src/shell/renderer/bridge/runtime-bridge/runtime-types.ts',
    'src/shell/renderer/bridge/runtime-bridge/types.ts',
    'src/shell/renderer/bridge/runtime-bridge.ts',
    'src/shell/renderer/bridge.ts',
  ];

  for (const relativePath of checkedSources) {
    const source = sourceAt(...relativePath.split('/'));
    assert.doesNotMatch(source, /runtime_mod_/);
    assert.doesNotMatch(source, /\bRuntimePackage(?:Source|Storage|Developer|Diagnostic|Reload|Install)/);
    assert.doesNotMatch(source, /\b(?:RuntimeLocalManifestSummary|RuntimeLocalAsset)\b/);
    assert.doesNotMatch(source, /\b(?:AvailableModUpdate|InstalledModPolicy|CatalogInstallResult)\b/);
  }
});

test('retired Desktop local-runtime SDK facade stays physically absent', () => {
  for (const relativePath of [
    'src/runtime/local-runtime/index.ts',
    'src/runtime/local-runtime/commands.ts',
    'src/runtime/local-runtime/commands-pickers.ts',
    'src/runtime/local-runtime/tauri-helpers.ts',
  ]) {
    assert.equal(existsSync(path.resolve(root, relativePath)), false);
  }
});
