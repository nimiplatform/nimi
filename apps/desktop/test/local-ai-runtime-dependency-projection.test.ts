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

test('local model center resolves shared runtime dependency readiness before any imported model is required', () => {
  assert.match(runtimeProjectionSources, /localRuntime\.resolveEnvironmentPlan/);
  assert.match(runtimeProjectionSources, /packId:\s*'local-gpu-support'/);
  assert.match(runtimeProjectionSources, /consumerScope:\s*'desktop\.local-model-center'/);
  assert.match(runtimeProjectionSources, /resolveLocalRuntimeImageNativeEnvironmentPlan/);
  assert.match(runtimeProjectionSources, /sharedRuntimeEnvironmentPlan/);
  assert.match(runtimeProjectionSources, /sharedRuntimeDependency/);
  assert.match(runtimeProjectionSources, /sharedRuntimeDependencyJobs/);
  assert.match(runtimeProjectionSources, /setupRuntimeDependency/);
  assert.match(runtimeProjectionSources, /localRuntime\.startEnvironmentDependencyJob/);
  assert.match(runtimeReadinessSource, /isLocalRuntimeEnvironmentDependencyReadyState/);
  assert.match(runtimeReadinessSource, /isLocalRuntimeEnvironmentDependencyStartableState/);
  assert.match(runtimeReadinessSource, /isLocalRuntimeEnvironmentDependencyJobActiveState/);
  assert.doesNotMatch(runtimeReadinessSource, /ACTIVE_RUNTIME_DEPENDENCY_JOB_STATES/);
  assert.doesNotMatch(runtimeReadinessSource, /STARTABLE_RUNTIME_DEPENDENCY_STATES/);
  assert.doesNotMatch(runtimeReadinessSource, /localRuntime\.startDependencySetup/);
  assert.doesNotMatch(runtimeReadinessSource, /localRuntime\.resolveDependency/);
  assert.doesNotMatch(runtimeReadinessSource, /stable-diffusion\.cpp/);
  assert.match(runtimeReadinessSource, /asset,\s*\}/);
  assert.match(runtimeReadinessSource, /prepareAssetRuntimeDependencies/);
  assert.match(runtimeProjectionSources, /runtimeDependencyByAssetId/);
});

test('local model center setup CTA projects shared dependency resolver truth at page level', () => {
  assert.match(installedSectionSource, /sharedRuntimeDependencyRequiresAttention/);
  assert.match(installedSectionSource, /props\.sharedRuntimeDependency/);
  assert.match(installedSectionSource, /props\.onSetupRuntimeDependency\(\)/);
  assert.match(installedSectionSource, /props\.onCancelRuntimeDependencyJob/);
  assert.match(installedSectionSource, /props\.onRetryRuntimeDependencyJob/);
  assert.match(installedSectionSource, /props\.onRepairRuntimeDependency/);
  assert.match(installedSectionSource, /isLocalRuntimeEnvironmentDependencyJobActiveState/);
  assert.match(installedSectionSource, /isLocalRuntimeEnvironmentDependencyJobRetryableState/);
  assert.match(installedSectionSource, /isLocalRuntimeEnvironmentDependencyNeedsConfirmationState/);
  assert.match(installedSectionSource, /isLocalRuntimeEnvironmentDependencyReadyState/);
  assert.match(installedSectionSource, /isLocalRuntimeEnvironmentDependencyJobFailedState/);
  assert.match(installedSectionSource, /runtimeDependencyBannerTitle/);
  assert.match(installedSectionSource, /runtimeDependencyStatusDetail/);
  assert.doesNotMatch(installedSectionSource, /ACTIVE_RUNTIME_DEPENDENCY_JOB_STATES/);
  assert.doesNotMatch(installedSectionSource, /RETRYABLE_RUNTIME_DEPENDENCY_JOB_STATES/);
  assert.doesNotMatch(installedSectionSource, /dependency\?\.state === 'needs_confirmation'/);
  assert.match(installedSectionSource, /dependency\.confirmationRequired/);
  assert.doesNotMatch(installedSectionSource, /cudaModelWaitingForSetup/);
  assert.match(installedSectionSource, /Local image runtime setup/);
  assert.match(installedSectionSource, /Local image runtime setup failed/);
  assert.doesNotMatch(installedSectionSource, /Nimi needs one local CUDA runtime package before local models can use GPU acceleration/);
  assert.doesNotMatch(installedSectionSource, /sharedRuntimeDependencyDetail/);
  assert.doesNotMatch(installedSectionSource, /dependency\.message \|\| props\.sharedRuntimeDependency/);
  assert.doesNotMatch(installedSectionSource, /materializable_requires_confirmation/);
  assert.doesNotMatch(
    installedSectionSource,
    /props\.onSetupRuntimeDependency\(asset\.localAssetId\)/,
  );
});

test('local model center projects Runtime-owned local environment state instead of desktop file fallback', () => {
  assert.match(runtimeProjectionSources, /localRuntime\.resolveEnvironmentPlan/);
  assert.match(runtimeProjectionSources, /sharedRuntimeEnvironmentPlan/);
  assert.match(runtimeViewSource, /LocalModelCenterInstalledAssetsSection/);
  assert.doesNotMatch(runtimeProjectionSources, /readTextFile|fs\.|state\.json/);
});

test('local runtime facade exposes SDK-backed local environment projection methods', () => {
  assert.equal(fs.existsSync(path.join(import.meta.dirname, '..', 'src/runtime/local-runtime/index.ts')), false);
  assert.doesNotMatch(runtimeProjectionSources, /@runtime\/local-runtime/);
  assert.match(runtimeProjectionSources, /from '@nimiplatform\/sdk\/runtime'/);
});
