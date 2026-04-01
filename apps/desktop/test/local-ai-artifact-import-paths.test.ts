import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const localModelCenterSectionsPath = path.resolve(
  process.cwd(),
  'src/shell/renderer/features/runtime-config/runtime-config-local-model-center-sections.tsx',
);
const runtimeCommandsPath = path.resolve(process.cwd(), 'src/runtime/local-runtime/commands.ts');
const runtimeHookFacadePath = path.resolve(process.cwd(), 'src/runtime/hook/contracts/facade.ts');

const localModelCenterSectionsSource = readFileSync(localModelCenterSectionsPath, 'utf-8');
const runtimeCommandsSource = readFileSync(runtimeCommandsPath, 'utf-8');
const runtimeHookFacadeSource = readFileSync(runtimeHookFacadePath, 'utf-8');

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
      return '/tmp/runtime-models/resolved/demo/manifest.json';
    },
    listen: async () => () => {},
  };

  try {
    const { pickLocalRuntimeAssetManifestPath } = await import('../src/runtime/local-runtime/commands');
    const manifestPath = await pickLocalRuntimeAssetManifestPath();
    assert.equal(manifestPath, '/tmp/runtime-models/resolved/demo/manifest.json');
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
  assert.match(runtimeCommandsSource, /importLocalRuntimeAsset\(\{ manifestPath: normalizedPath \}/);
  assert.match(runtimeCommandsSource, /export async function importLocalRuntimeAssetManifest/);
});

test('asset file import uses unified importLocalRuntimeAssetFile and scaffoldLocalRuntimeOrphanAsset', () => {
  assert.match(runtimeCommandsSource, /export async function importLocalRuntimeAssetFile/);
  assert.match(runtimeCommandsSource, /export async function scaffoldLocalRuntimeOrphanAsset/);
  assert.match(runtimeCommandsSource, /runtime\.scaffoldOrphanAsset\(\{/);
  assert.match(runtimeCommandsSource, /runtime\.importLocalAssetFile\(\{/);
});

test('local model center uses one runtime manifest import entry and one asset file import entry', () => {
  assert.match(localModelCenterSectionsSource, /Import Asset File/);
  assert.match(localModelCenterSectionsSource, /Import Runtime Manifest/);
  assert.doesNotMatch(localModelCenterSectionsSource, /Import Model Manifest/);
  assert.doesNotMatch(localModelCenterSectionsSource, /Import Artifact Manifest/);
});

test('hook facade accepts vae as a first-class asset kind', () => {
  assert.match(runtimeHookFacadeSource, /assetKind\?:/);
  assert.match(runtimeHookFacadeSource, /'vae'/);
});
