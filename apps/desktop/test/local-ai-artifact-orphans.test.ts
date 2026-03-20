import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const runtimeCommandsPath = path.resolve(process.cwd(), 'src/runtime/local-runtime/commands.ts');
const runtimeIndexPath = path.resolve(process.cwd(), 'src/runtime/local-runtime/index.ts');
const localModelCenterPath = path.resolve(
  process.cwd(),
  'src/shell/renderer/features/runtime-config/runtime-config-local-model-center.tsx',
);
const localModelCenterRuntimeStatePath = path.resolve(
  process.cwd(),
  'src/shell/renderer/features/runtime-config/runtime-config-use-local-model-center-runtime-state.ts',
);
const localModelCenterSectionsPath = path.resolve(
  process.cwd(),
  'src/shell/renderer/features/runtime-config/runtime-config-local-model-center-sections.tsx',
);
const localModelCenterHelpersPath = path.resolve(
  process.cwd(),
  'src/shell/renderer/features/runtime-config/runtime-config-local-model-center-helpers.tsx',
);

const runtimeCommandsSource = readFileSync(runtimeCommandsPath, 'utf-8');
const runtimeIndexSource = readFileSync(runtimeIndexPath, 'utf-8');
const localModelCenterSource = [
  localModelCenterPath,
  localModelCenterRuntimeStatePath,
]
  .map((filePath) => readFileSync(filePath, 'utf-8'))
  .join('\n');
const localModelCenterSectionsSource = readFileSync(localModelCenterSectionsPath, 'utf-8');
const localModelCenterHelpersSource = readFileSync(localModelCenterHelpersPath, 'utf-8');

test('local runtime exposes unified asset intake command surface', () => {
  assert.match(runtimeCommandsSource, /runtime_local_assets_scan_unregistered/);
  assert.match(runtimeCommandsSource, /runtime_local_pick_asset_manifest_path/);
  assert.match(runtimeCommandsSource, /export async function scanLocalRuntimeUnregisteredAssets/);
  assert.match(runtimeCommandsSource, /export async function importLocalRuntimeAssetFile/);
  assert.match(runtimeCommandsSource, /export async function importLocalRuntimeAssetManifest/);
});

test('local runtime facade exports unified asset intake methods', () => {
  assert.match(runtimeIndexSource, /scanUnregisteredAssets:\s*\(\)\s*=>\s*Promise<LocalRuntimeUnregisteredAssetDescriptor\[]>/);
  assert.match(runtimeIndexSource, /importAssetFile:\s*\(\s*payload: LocalRuntimeImportAssetFilePayload/);
  assert.match(runtimeIndexSource, /importAssetManifest:\s*\(\s*manifestPath: string/);
  assert.match(runtimeIndexSource, /scanUnregisteredAssets:\s*scanLocalRuntimeUnregisteredAssets/);
  assert.match(runtimeIndexSource, /importAssetFile:\s*importLocalRuntimeAssetFile/);
});

test('local model center renders a unified unregistered assets review lane', () => {
  assert.match(localModelCenterSectionsSource, /Unregistered Assets/);
  assert.match(localModelCenterSectionsSource, /Typed folders import automatically/);
  assert.match(localModelCenterSectionsSource, /LocalModelCenterUnregisteredAssetsSection/);
  assert.match(localModelCenterSectionsSource, /Review needed/);
});

test('runtime state refreshes unified unregistered assets and auto-imports high-confidence items', () => {
  assert.match(localModelCenterSource, /scanUnregisteredAssets\(\)/);
  assert.match(localModelCenterSource, /refreshUnregisteredAssets/);
  assert.match(localModelCenterSource, /asset\.autoImportable/);
  assert.match(localModelCenterSource, /importActions\.importAssetFromPath\(asset\.path,\s*draft\)/);
});

test('artifact kind helpers keep ae as a first-class companion asset', () => {
  assert.match(localModelCenterHelpersSource, /'ae'/);
  assert.match(localModelCenterHelpersSource, /case 'ae':/);
});

test('artifact tasks still expose retry only for failed verified installs', () => {
  assert.match(localModelCenterSectionsSource, /task\.taskKind === 'verified-install'/);
  assert.match(localModelCenterSectionsSource, /Retry/);
  assert.match(localModelCenterSectionsSource, /props\.onRetryTask\(task\.templateId\)/);
});
