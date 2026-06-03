import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

function readSdkSource(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), 'src', relativePath), 'utf8');
}

const commandsAssetsSource = readSdkSource('runtime/local-runtime-client/commands-assets.ts');
const commandsSource = readSdkSource('runtime/local-runtime-client/commands.ts');
const runtimeTypesSource = readSdkSource('runtime/local-runtime-client/types.ts');
const facadeSource = readSdkSource('runtime/local-runtime-client/index.ts');
const runtimeEventsParsersSource = readSdkSource('runtime/local-runtime-client/parsers-runtime-events.ts');
const parsersSource = readSdkSource('runtime/local-runtime-client/parsers.ts');
const localAssetKindSource = readSdkSource('runtime/local-asset-kind.ts');

test('local runtime recommendation feed command is SDK Runtime-projection only', () => {
  assert.match(
    runtimeTypesSource,
    /export type LocalRuntimeRecommendationFeedGetPayload = \{\s*capability\?: LocalRuntimeRecommendationFeedCapability;/,
  );
  assert.doesNotMatch(
    runtimeTypesSource,
    /export type LocalRuntimeRecommendationFeedGetPayload = \{\s*capability\?: .*string/,
  );
  assert.doesNotMatch(commandsSource, /runtime_local_recommendation_feed_get/);
  assert.doesNotMatch(commandsSource, /invokeLocalRuntimeCommand/);
  assert.match(commandsSource, /requireSdkLocal\(\)/);
  assert.match(commandsSource, /runtime\.getRecommendationFeed\(\{/);
  assert.match(
    commandsSource,
    /capability:\s*toLocalRecommendationFeedCapabilityRequestValue\(payload\?\.capability\),\s*pageSize:\s*Number\(payload\?\.pageSize \|\| 0\),/,
  );
});

test('local runtime transfer plane resolves through typed Runtime APIs', () => {
  assert.match(commandsAssetsSource, /runtime\.listLocalTransfers\(\{\}\)/);
  assert.match(commandsAssetsSource, /runtime\.pauseLocalTransfer\(\{/);
  assert.match(commandsAssetsSource, /runtime\.resumeLocalTransfer\(\{/);
  assert.match(commandsAssetsSource, /runtime\.cancelLocalTransfer\(\{/);
  assert.match(commandsAssetsSource, /runtime\.watchLocalTransfers\(\{\}, \{ signal: controller\.signal \}\)/);
});

test('local runtime asset intake commands use Runtime SDK requests', () => {
  assert.match(commandsAssetsSource, /export async function importLocalRuntimeAssetManifest/);
  assert.match(commandsAssetsSource, /export async function importLocalRuntimeAssetFile/);
  assert.match(commandsAssetsSource, /export async function scaffoldLocalRuntimeOrphanAsset/);
  assert.match(commandsAssetsSource, /runtime\.importLocalAsset\(\{/);
  assert.match(commandsAssetsSource, /runtime\.importLocalAssetFile\(\{/);
  assert.match(commandsAssetsSource, /runtime\.scaffoldOrphanAsset\(\{/);
  assert.match(commandsAssetsSource, /runtime\.scanUnregisteredAssets\(\{\}\)/);
  assert.match(commandsAssetsSource, /endpoint: String\(options\?\.endpoint \|\| ''\)\.trim\(\) \|\| undefined/);
  assert.doesNotMatch(commandsAssetsSource, /runtime_local_assets_adopt/);
  assert.doesNotMatch(commandsAssetsSource, /runtime_local_assets_import['"]/);
  assert.doesNotMatch(commandsAssetsSource, /runtime_local_assets_import_file/);
  assert.doesNotMatch(commandsAssetsSource, /runtime_local_assets_scaffold_orphan/);
});

test('local runtime facade exposes unified asset intake and environment projection methods', () => {
  assert.match(facadeSource, /scanUnregisteredAssets:\s*\(\)\s*=>\s*Promise<LocalRuntimeUnregisteredAssetDescriptor\[]>/);
  assert.match(facadeSource, /importAssetFile:\s*\(\s*payload: LocalRuntimeImportAssetFilePayload/);
  assert.match(facadeSource, /importAssetManifest:\s*\(\s*manifestPath: string/);
  assert.match(facadeSource, /scanUnregisteredAssets:\s*scanLocalRuntimeUnregisteredAssets/);
  assert.match(facadeSource, /importAssetFile:\s*importLocalRuntimeAssetFile/);
  assert.match(facadeSource, /resolveEnvironmentPlan:\s*resolveLocalRuntimeEnvironmentPlan/);
  assert.match(facadeSource, /listEnvironmentDependencyJobs:\s*listLocalRuntimeEnvironmentDependencyJobs/);
  assert.match(facadeSource, /startEnvironmentDependencyJob:\s*startLocalRuntimeEnvironmentDependencyJob/);
  assert.match(facadeSource, /cancelEnvironmentDependencyJob:\s*cancelLocalRuntimeEnvironmentDependencyJob/);
  assert.match(facadeSource, /retryEnvironmentDependencyJob:\s*retryLocalRuntimeEnvironmentDependencyJob/);
  assert.match(facadeSource, /repairEnvironmentDependency:\s*repairLocalRuntimeEnvironmentDependency/);
  assert.doesNotMatch(facadeSource, /listEnvironmentSelectedSources/);
  assert.doesNotMatch(facadeSource, /resolveEnvironmentActivationGate/);
  assert.doesNotMatch(facadeSource, /startDependencySetup/);
});

test('local runtime dependency plan and job parsers delegate projection ownership to SDK parsers', () => {
  assert.match(runtimeEventsParsersSource, /parseLocalRuntimeEnvironmentPlanProjection/);
  assert.match(runtimeEventsParsersSource, /parseLocalRuntimeEnvironmentDependencyJobProjection/);
  assert.match(runtimeEventsParsersSource, /parseLocalRuntimeEnvironmentPlanProjection as parseLocalRuntimeEnvironmentPlan/);
  assert.doesNotMatch(runtimeEventsParsersSource, /function parseLocalRuntimeEnvironmentPlan\(/);
  assert.doesNotMatch(runtimeEventsParsersSource, /function parseLocalRuntimeEnvironmentDependencyJob\(/);
  assert.doesNotMatch(runtimeEventsParsersSource, /function clampPercent\(/);
});

test('local runtime facade does not expose unmounted local service lifecycle controls', () => {
  assert.doesNotMatch(facadeSource, /\blistServices:/);
  assert.doesNotMatch(facadeSource, /\binstallService:/);
  assert.doesNotMatch(facadeSource, /\bstartService:/);
  assert.doesNotMatch(facadeSource, /\bstopService:/);
  assert.doesNotMatch(facadeSource, /\bhealthServices:/);
  assert.doesNotMatch(facadeSource, /\bremoveService:/);
  assert.match(facadeSource, /listNodesCatalog:\s*listLocalRuntimeNodesCatalog/);
});

test('local runtime asset kind DX owns passive VAE and canonical kind typing', () => {
  assert.match(runtimeTypesSource, /export type LocalRuntimeAssetKind = LocalRuntimeAssetKindId/);
  assert.match(localAssetKindSource, /\|\s*'vae'/);
  assert.match(localAssetKindSource, /vae:\s*'VAE'/);
});

test('local runtime asset parsers preserve endpoint and engine runtime mode projections', () => {
  assert.match(parsersSource, /endpoint: asString\(record\.endpoint\) \|\| undefined/);
  assert.match(
    parsersSource,
    /engineRuntimeMode: record\.engineRuntimeMode == null\s*\?\s*undefined\s*:\s*normalizeEngineRuntimeMode\(record\.engineRuntimeMode\)/,
  );
});

test('local runtime lifecycle writes route through SDK Runtime service only', () => {
  assert.match(commandsAssetsSource, /runtime\.startLocalAsset\(\{/);
  assert.match(commandsAssetsSource, /runtime\.stopLocalAsset\(\{/);
  assert.match(commandsAssetsSource, /runtime\.removeLocalAsset\(\{/);
});
