import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

function readWorkspaceFile(relativePath: string): string {
  return fs.readFileSync(path.join(import.meta.dirname, '..', relativePath), 'utf8');
}

const runtimeStateSource = readWorkspaceFile(
  'src/shell/renderer/features/runtime-config/runtime-config-use-local-model-center-runtime-state.ts',
);
const runtimeReadinessSource = readWorkspaceFile(
  'src/shell/renderer/features/runtime-config/runtime-config-use-local-model-center-runtime-readiness.ts',
);
const runtimeProjectionSources = `${runtimeStateSource}\n${runtimeReadinessSource}`;
const installedSectionSource = readWorkspaceFile(
  'src/shell/renderer/features/runtime-config/runtime-config-local-model-center-installed-section.tsx',
);
const runtimeViewSource = readWorkspaceFile(
  'src/shell/renderer/features/runtime-config/runtime-config-local-model-center-runtime-view.tsx',
);
const localRuntimeFacadeSource = readWorkspaceFile(
  'src/runtime/local-runtime/index.ts',
);

test('local model center resolves shared runtime dependency readiness before any imported model is required', () => {
  assert.match(runtimeProjectionSources, /localRuntime\.resolveDependency/);
  assert.match(runtimeProjectionSources, /dependencyId:\s*'nvidia-cuda-user-space-runtime'/);
  assert.match(runtimeProjectionSources, /sharedRuntimeDependency/);
  assert.match(runtimeProjectionSources, /setupRuntimeDependency/);
  assert.doesNotMatch(runtimeReadinessSource, /consumerId:\s*'stable-diffusion\.cpp\.cuda'/);
  assert.doesNotMatch(runtimeReadinessSource, /localAssetId:\s*asset\.localAssetId/);
  assert.match(runtimeProjectionSources, /runtimeDependencyByAssetId/);
});

test('local model center setup CTA projects shared dependency resolver truth at page level', () => {
  assert.match(installedSectionSource, /sharedRuntimeDependencyNeedsSetup/);
  assert.match(installedSectionSource, /props\.sharedRuntimeDependency/);
  assert.match(installedSectionSource, /props\.onSetupRuntimeDependency\(\)/);
  assert.match(installedSectionSource, /dependency\.state === 'materializable_requires_confirmation'/);
  assert.match(installedSectionSource, /dependency\.confirmationRequired === true/);
  assert.doesNotMatch(
    installedSectionSource,
    /props\.onSetupRuntimeDependency\(asset\.localAssetId\)/,
  );
});

test('local model center projects Runtime-owned state cutover instead of desktop file fallback', () => {
  assert.match(runtimeProjectionSources, /localRuntime\.resolveLocalStateReconciliation/);
  assert.match(runtimeProjectionSources, /localRuntime\.executeLocalStateCutover/);
  assert.match(runtimeProjectionSources, /confirmed:\s*true/);
  assert.match(runtimeViewSource, /LocalModelCenterStateCutoverSection/);
  assert.match(runtimeViewSource, /Import existing local model state/);
  assert.doesNotMatch(runtimeProjectionSources, /readTextFile|fs\.|state\.json/);
});

test('local runtime facade exposes SDK-backed local state reconciliation methods', () => {
  assert.match(localRuntimeFacadeSource, /resolveLocalStateReconciliation:\s*resolveLocalRuntimeStateReconciliation/);
  assert.match(localRuntimeFacadeSource, /executeLocalStateCutover:\s*executeLocalRuntimeStateCutover/);
});
