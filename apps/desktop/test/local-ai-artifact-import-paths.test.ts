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
const runtimeCommandsPath = path.resolve(process.cwd(), 'src/runtime/local-runtime/commands.ts');
const artifactOrphansCommandPath = path.resolve(
  process.cwd(),
  'src-tauri/src/local_runtime/commands/commands_artifact_orphans.rs',
);

const installActionsSource = readFileSync(installActionsPath, 'utf-8');
const modelActionsSource = readFileSync(modelActionsPath, 'utf-8');
const localModelCenterSectionsSource = readFileSync(localModelCenterSectionsPath, 'utf-8');
const runtimeCommandsSource = readFileSync(runtimeCommandsPath, 'utf-8');
const artifactOrphansCommandSource = readFileSync(artifactOrphansCommandPath, 'utf-8');

type TauriInvokeCall = {
  command: string;
  payload: unknown;
};

test('pickLocalRuntimeArtifactManifestPath uses the dedicated Tauri command', async () => {
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
    const { pickLocalRuntimeArtifactManifestPath } = await import('../src/runtime/local-runtime/commands');
    const manifestPath = await pickLocalRuntimeArtifactManifestPath();
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
    /const importLocalArtifact = useCallback\(async \(\) => \{([\s\S]*?)\n\s*\}, \[[\s\S]*?\]\);/,
  );
  assert.ok(match, 'expected importLocalArtifact callback in install actions source');
  const body = String(match?.[1] || '');
  assert.match(body, /pickArtifactManifestPath\(\)/);
  assert.doesNotMatch(body, /pickManifestPath\(\)/);
  assert.match(body, /importArtifact\(\{ manifestPath \}, \{ caller: 'core' \}\)/);
});

test('main model import keeps the dedicated model manifest picker', () => {
  const match = modelActionsSource.match(
    /const importLocalModel = useCallback\(async \(\) => \{([\s\S]*?)\n\s*\}, \[[\s\S]*?\]\);/,
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

test('artifact import command is wired to the dedicated Tauri artifact command', () => {
  assert.match(
    runtimeCommandsSource,
    /export async function importLocalRuntimeArtifact[\s\S]*runtime_local_artifacts_import/,
  );
});

test('artifact runtime commands call dedicated Tauri artifact surfaces', async () => {
  const calls: TauriInvokeCall[] = [];
  const globalRecord = globalThis as Record<string, unknown>;
  const previousTauri = globalRecord.__TAURI__;

  globalRecord.__TAURI__ = {
    core: {
      invoke: async (command: string, payload?: unknown) => {
        calls.push({ command, payload });
        if (command === 'runtime_local_artifacts_list') {
          return [{
            localArtifactId: 'artifact-1',
            artifactId: 'z-image-ae',
            kind: 'vae',
            engine: 'localai',
            entry: 'ae.safetensors',
            files: ['ae.safetensors'],
            license: 'apache-2.0',
            source: { repo: 'Tongyi-MAI/Z-Image', revision: 'main' },
            hashes: { 'ae.safetensors': 'sha256:abc' },
            status: 'installed',
            installedAt: '2026-03-14T00:00:00Z',
            updatedAt: '2026-03-14T00:00:00Z',
          }];
        }
        return {
          localArtifactId: 'artifact-1',
          artifactId: 'z-image-ae',
          kind: 'vae',
          engine: 'localai',
          entry: 'ae.safetensors',
          files: ['ae.safetensors'],
          license: 'apache-2.0',
          source: { repo: 'Tongyi-MAI/Z-Image', revision: 'main' },
          hashes: { 'ae.safetensors': 'sha256:abc' },
          status: 'installed',
          installedAt: '2026-03-14T00:00:00Z',
          updatedAt: '2026-03-14T00:00:00Z',
        };
      },
    },
  };

  try {
    const {
      importLocalRuntimeArtifact,
      installLocalRuntimeVerifiedArtifact,
      listLocalRuntimeArtifacts,
      removeLocalRuntimeArtifact,
    } = await import('../src/runtime/local-runtime/commands');

    await listLocalRuntimeArtifacts({ kind: 'vae', engine: 'localai' });
    await installLocalRuntimeVerifiedArtifact({ templateId: 'verified.artifact.z_image.vae' }, { caller: 'core' });
    await importLocalRuntimeArtifact({ manifestPath: '/tmp/artifact.manifest.json' }, { caller: 'core' });
    await removeLocalRuntimeArtifact('artifact-1', { caller: 'core' });

    assert.deepEqual(calls, [
      {
        command: 'runtime_local_artifacts_list',
        payload: { payload: { status: undefined, kind: 'vae', engine: 'localai' } },
      },
      {
        command: 'runtime_local_artifacts_install_verified',
        payload: { payload: { templateId: 'verified.artifact.z_image.vae' } },
      },
      {
        command: 'runtime_local_artifacts_import',
        payload: { payload: { manifestPath: '/tmp/artifact.manifest.json' } },
      },
      {
        command: 'runtime_local_artifacts_remove',
        payload: { payload: { localArtifactId: 'artifact-1' } },
      },
    ]);
  } finally {
    if (typeof previousTauri === 'undefined') {
      delete globalRecord.__TAURI__;
    } else {
      globalRecord.__TAURI__ = previousTauri;
    }
  }
});

test('profile apply trusts Tauri-installed artifacts and does not re-install them in TS', async () => {
  const calls: TauriInvokeCall[] = [];
  const globalRecord = globalThis as Record<string, unknown>;
  const previousTauri = globalRecord.__TAURI__;

  globalRecord.__TAURI__ = {
    core: {
      invoke: async (command: string, payload?: unknown) => {
        calls.push({ command, payload });
        if (command === 'runtime_local_profiles_apply') {
          return {
            planId: 'plan-image',
            modId: 'mod.image',
            profileId: 'quality-best',
            executionResult: {
              planId: 'dep-plan-image',
              modId: 'mod.image',
              entries: [],
              installedModels: [],
              services: [],
              capabilities: ['image'],
              stageResults: [],
              preflightDecisions: [],
              rollbackApplied: false,
              warnings: [],
            },
            installedArtifacts: [{
              localArtifactId: 'artifact-1',
              artifactId: 'z-image-ae',
              kind: 'vae',
              engine: 'localai',
              entry: 'ae.safetensors',
              files: ['ae.safetensors'],
              license: 'apache-2.0',
              source: { repo: 'Tongyi-MAI/Z-Image', revision: 'main' },
              hashes: { 'ae.safetensors': 'sha256:abc' },
              status: 'installed',
              installedAt: '2026-03-14T00:00:00Z',
              updatedAt: '2026-03-14T00:00:00Z',
            }],
            warnings: [],
          };
        }
        throw new Error(`unexpected command: ${command}`);
      },
    },
  };

  try {
    const { applyLocalRuntimeProfile } = await import('../src/runtime/local-runtime/commands');
    const result = await applyLocalRuntimeProfile({
      planId: 'plan-image',
      modId: 'mod.image',
      profileId: 'quality-best',
      title: 'Quality Best',
      recommended: true,
      consumeCapabilities: ['image'],
      executionPlan: {
        planId: 'dep-plan-image',
        modId: 'mod.image',
        deviceProfile: {
          os: 'darwin',
          arch: 'arm64',
          gpu: {
            available: true,
            vendor: 'apple',
            model: 'M3 Max',
          },
          python: {
            available: true,
            version: '3.11.9',
          },
          npu: {
            available: false,
            ready: false,
          },
          diskFreeBytes: 256 * 1024 * 1024 * 1024,
          ports: [],
        },
        entries: [],
        selectionRationale: [],
        preflightDecisions: [],
        warnings: [],
      },
      artifactEntries: [{
        entryId: 'image-vae',
        kind: 'artifact',
        artifactId: 'z-image-ae',
        artifactKind: 'vae',
        templateId: 'verified.artifact.z_image.vae',
        engine: 'localai',
        installed: false,
      }],
      warnings: [],
    }, { caller: 'core' });

    assert.equal(result.installedArtifacts.length, 1);
    assert.deepEqual(
      calls.map((call) => call.command),
      ['runtime_local_profiles_apply'],
    );
  } finally {
    if (typeof previousTauri === 'undefined') {
      delete globalRecord.__TAURI__;
    } else {
      globalRecord.__TAURI__ = previousTauri;
    }
  }
});

test('artifact orphan scaffold command runs blocking file work off the Tauri UI thread', () => {
  assert.match(
    artifactOrphansCommandSource,
    /#\[tauri::command\]\s*pub async fn runtime_local_artifacts_scaffold_orphan/,
  );
  assert.match(
    artifactOrphansCommandSource,
    /tauri::async_runtime::spawn_blocking\(move \|\| \{\s*scaffold_orphan_artifact_file/,
  );
});
