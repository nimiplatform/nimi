import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const installActionsPath = path.resolve(
  process.cwd(),
  'src/shell/renderer/features/runtime-config/runtime-config-panel-controller-install-actions.ts',
);
const modelActionsPath = path.resolve(
  process.cwd(),
  'src/shell/renderer/features/runtime-config/runtime-config-panel-controller-install-actions-models.ts',
);
const localModelCenterSectionsPath = path.resolve(
  process.cwd(),
  'src/shell/renderer/features/runtime-config/runtime-config-local-model-center-sections.tsx',
);
const runtimeCommandsPath = path.resolve(process.cwd(), 'src/runtime/local-ai-runtime/commands.ts');

const installActionsSource = readFileSync(installActionsPath, 'utf-8');
const modelActionsSource = readFileSync(modelActionsPath, 'utf-8');
const localModelCenterSectionsSource = readFileSync(localModelCenterSectionsPath, 'utf-8');
const runtimeCommandsSource = readFileSync(runtimeCommandsPath, 'utf-8');

type TauriInvokeCall = {
  command: string;
  payload: unknown;
};

test('pickLocalAiRuntimeArtifactManifestPath uses the dedicated Tauri command', async () => {
  const calls: TauriInvokeCall[] = [];
  const globalRecord = globalThis as Record<string, unknown>;
  const previousTauri = globalRecord.__TAURI__;

  globalRecord.__TAURI__ = {
    core: {
      invoke: async (command: string, payload?: unknown) => {
        calls.push({ command, payload });
        return '/tmp/runtime-models/demo/artifact.manifest.json';
      },
    },
  };

  try {
    const { pickLocalAiRuntimeArtifactManifestPath } = await import('../src/runtime/local-ai-runtime/commands');
    const manifestPath = await pickLocalAiRuntimeArtifactManifestPath();
    assert.equal(manifestPath, '/tmp/runtime-models/demo/artifact.manifest.json');
    assert.deepEqual(calls, [{
      command: 'runtime_local_pick_artifact_manifest_path',
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

test('artifact import controller uses pickArtifactManifestPath and runtime artifact import', () => {
  const match = installActionsSource.match(
    /const importLocalArtifact = useCallback\(async \(\) => \{([\s\S]*?)\n\s{2}\}, \[refreshLocalSnapshot, setStatusBanner\]\);/,
  );
  assert.ok(match, 'expected importLocalArtifact callback in install actions source');
  const body = String(match?.[1] || '');
  assert.match(body, /pickArtifactManifestPath\(\)/);
  assert.doesNotMatch(body, /pickManifestPath\(\)/);
  assert.match(body, /importArtifact\(\{ manifestPath \}, \{ caller: 'core' \}\)/);
});

test('main model import keeps the dedicated model manifest picker', () => {
  const match = modelActionsSource.match(
    /const importLocalModel = useCallback\(async \(\) => \{([\s\S]*?)\n\s{2}\}, \[recordGoRuntimeSyncFailure, refreshLocalSnapshot, setStatusBanner\]\);/,
  );
  assert.ok(match, 'expected importLocalModel callback in model actions source');
  const body = String(match?.[1] || '');
  assert.match(body, /pickManifestPath\(\)/);
  assert.doesNotMatch(body, /pickArtifactManifestPath\(\)/);
});

test('local model center keeps model and artifact import entries separated', () => {
  assert.match(localModelCenterSectionsSource, /Import Model Manifest/);
  assert.match(localModelCenterSectionsSource, /Import Artifact Manifest/);
});

test('artifact import command still reaches runtime local importLocalArtifact', () => {
  assert.match(
    runtimeCommandsSource,
    /export async function importLocalAiRuntimeArtifact[\s\S]*getSdkLocal\(\)\.importLocalArtifact\(\{/,
  );
});
