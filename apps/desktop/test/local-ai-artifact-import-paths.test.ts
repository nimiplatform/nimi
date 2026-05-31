import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const localModelCenterSectionsPath = path.resolve(
  process.cwd(),
  'src/shell/renderer/features/runtime-config/runtime-config-local-model-center-sections.tsx',
);
const runtimeCommandsPath = path.resolve(process.cwd(), '../../sdk/src/runtime/local-runtime-client/commands-assets.ts');
const runtimeLocalTypesPath = path.resolve(process.cwd(), '../../sdk/src/runtime/local-runtime-client/types.ts');
const sdkLocalAssetKindPath = path.resolve(process.cwd(), '../../sdk/src/runtime/local-asset-kind.ts');
const runtimeHookDirPath = path.resolve(process.cwd(), 'src/runtime/hook');

const localModelCenterSectionsSource = readFileSync(localModelCenterSectionsPath, 'utf-8');
const runtimeCommandsSource = readFileSync(runtimeCommandsPath, 'utf-8');
const runtimeLocalTypesSource = readFileSync(runtimeLocalTypesPath, 'utf-8');
const sdkLocalAssetKindSource = readFileSync(sdkLocalAssetKindPath, 'utf-8');

type TauriInvokeCall = {
  command: string;
  payload: unknown;
};

test('pickLocalRuntimeAssetManifestPath uses the unified Tauri manifest picker', async () => {
  const calls: TauriInvokeCall[] = [];
  const globalRecord = globalThis as Record<string, unknown>;
  const previousHook = globalRecord.__NIMI_TAURI_TEST__;

  globalRecord.__NIMI_TAURI_TEST__ = {
    invoke: async (command: string, payload?: unknown) => {
      calls.push({ command, payload });
      return '/tmp/runtime-models/resolved/demo/asset.manifest.json';
    },
    listen: async () => () => {},
  };

  try {
    const { pickLocalRuntimeAssetManifestPath } = await import('../src/runtime/local-runtime/commands');
    const manifestPath = await pickLocalRuntimeAssetManifestPath();
    assert.equal(manifestPath, '/tmp/runtime-models/resolved/demo/asset.manifest.json');
    assert.deepEqual(calls, [{
      command: 'runtime_local_pick_asset_manifest_path',
      payload: {},
    }]);
  } finally {
    if (typeof previousHook === 'undefined') {
      delete globalRecord.__NIMI_TAURI_TEST__;
    } else {
      globalRecord.__NIMI_TAURI_TEST__ = previousHook;
    }
  }
});

test('asset manifest import uses the unified importLocalRuntimeAsset command', () => {
  assert.match(runtimeCommandsSource, /importLocalRuntimeAsset\(\{\s*manifestPath: normalizedPath,\s*endpoint: String\(options\?\.endpoint \|\| ''\)\.trim\(\) \|\| undefined,\s*\}, options\)/s);
  assert.match(runtimeCommandsSource, /export async function importLocalRuntimeAssetManifest/);
  assert.match(runtimeCommandsSource, /runtime\.importLocalAsset\(\{/);
  assert.doesNotMatch(runtimeCommandsSource, /runtime_local_assets_adopt/);
  assert.doesNotMatch(runtimeCommandsSource, /runtime_local_assets_import['"]/);
});

test('asset file import uses unified importLocalRuntimeAssetFile and scaffoldLocalRuntimeOrphanAsset', () => {
  assert.match(runtimeCommandsSource, /export async function importLocalRuntimeAssetFile/);
  assert.match(runtimeCommandsSource, /export async function scaffoldLocalRuntimeOrphanAsset/);
  assert.match(runtimeCommandsSource, /runtime\.importLocalAssetFile\(\{/);
  assert.match(runtimeCommandsSource, /runtime\.scaffoldOrphanAsset\(\{/);
  assert.doesNotMatch(runtimeCommandsSource, /runtime_local_assets_import_file/);
  assert.doesNotMatch(runtimeCommandsSource, /runtime_local_assets_scaffold_orphan/);
});

test('local model center uses one runtime manifest import entry and one asset file import entry', () => {
  assert.match(localModelCenterSectionsSource, /Import Asset File/);
  assert.match(localModelCenterSectionsSource, /Import Runtime Manifest/);
  assert.doesNotMatch(localModelCenterSectionsSource, /Import Model Manifest/);
  assert.doesNotMatch(localModelCenterSectionsSource, /Import Artifact Manifest/);
});

test('local runtime owns vae as a first-class asset kind after hook retirement', () => {
  assert.equal(existsSync(runtimeHookDirPath), false);
  assert.match(runtimeLocalTypesSource, /export type LocalRuntimeAssetKind = LocalRuntimeAssetKindId/);
  assert.match(sdkLocalAssetKindSource, /\| 'vae'/);
});
