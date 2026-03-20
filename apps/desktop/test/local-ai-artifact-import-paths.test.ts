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
  const previousTauri = globalRecord.__TAURI__;

  globalRecord.__TAURI__ = {
    core: {
      invoke: async (command: string, payload?: unknown) => {
        calls.push({ command, payload });
        return '/tmp/runtime-models/resolved/demo/manifest.json';
      },
    },
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
    if (typeof previousTauri === 'undefined') {
      delete globalRecord.__TAURI__;
    } else {
      globalRecord.__TAURI__ = previousTauri;
    }
  }
});

test('asset manifest import routes artifact manifests to the artifact command and model manifests to the model command', () => {
  assert.match(runtimeCommandsSource, /normalizedPath\.endsWith\('artifact\.manifest\.json'\)/);
  assert.match(runtimeCommandsSource, /importLocalRuntimeArtifact\(\{ manifestPath: normalizedPath \}/);
  assert.match(runtimeCommandsSource, /importLocalRuntimeModel\(\{ manifestPath: normalizedPath \}/);
});

test('asset file import scaffolds companion assets before artifact import and maps model types to capabilities', () => {
  assert.match(runtimeCommandsSource, /scaffoldLocalRuntimeArtifactOrphan\(\{/);
  assert.match(runtimeCommandsSource, /importLocalRuntimeArtifact\(\{\s*manifestPath: scaffolded\.manifestPath/);
  assert.match(runtimeCommandsSource, /function capabilitiesForModelType/);
  assert.match(runtimeCommandsSource, /if \(modelType === 'embedding'\) return \['embedding'\]/);
  assert.match(runtimeCommandsSource, /if \(modelType === 'music'\) return \['music'\]/);
});

test('local model center uses one runtime manifest import entry and one asset file import entry', () => {
  assert.match(localModelCenterSectionsSource, /Import Asset File/);
  assert.match(localModelCenterSectionsSource, /Import Runtime Manifest/);
  assert.doesNotMatch(localModelCenterSectionsSource, /Import Model Manifest/);
  assert.doesNotMatch(localModelCenterSectionsSource, /Import Artifact Manifest/);
});

test('hook facade accepts ae as a first-class artifact kind', () => {
  assert.match(runtimeHookFacadeSource, /artifactKind\?: 'vae' \| 'ae' \| 'llm'/);
});
