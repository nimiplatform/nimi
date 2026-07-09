import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

function readRepo(path: string): string {
  return readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8');
}

const retiredPackageKindPattern = new RegExp(`package_kind:\\s*(${['public', 'mod'].join('-')}|extension)\\b`);

describe('Nimi App registry/admission domain boundary', () => {
  it('keeps admission, registry, and release descriptor authority in platform spec tables', () => {
    const admissionContract = readRepo('.nimi/spec/platform/kernel/nimi-app-admission-contract.md');
    const appSliceContract = readRepo('.nimi/spec/platform/kernel/app-slice-admission-contract.md');
    const registryTable = readRepo('.nimi/spec/platform/kernel/tables/nimi-app-registry.yaml');
    const releaseDescriptors = readRepo(
      '.nimi/spec/platform/kernel/tables/nimi-app-release-descriptors.yaml',
    );
    const localConfigRegistry = readRepo(
      '.nimi/spec/platform/kernel/tables/local-config-file-registry.yaml',
    );

    assert.match(admissionContract, /Platform (owns|拥有) Nimi App admission/);
    assert.match(admissionContract, /Apps 不得拥有 admission truth/);
    assert.match(admissionContract, /tables\/nimi-app-registry\.yaml/);
    assert.match(admissionContract, /tables\/nimi-app-release-descriptors\.yaml/);
    assert.match(appSliceContract, /only repo-wide admission source for app-local spec slices/);
    assert.match(appSliceContract, /must not claim repo-wide semantics/);

    assert.doesNotMatch(registryTable, retiredPackageKindPattern);
    assert.doesNotMatch(releaseDescriptors, retiredPackageKindPattern);
    assert.match(registryTable, /package_kind:\s*nimi-app/);
    assert.match(releaseDescriptors, /package_kind:\s*nimi-app/);

    assert.match(localConfigRegistry, /config_file_id:\s*registry_json/);
    assert.match(localConfigRegistry, /schema_owner:\s*account_apps_registry/);
    assert.match(localConfigRegistry, /config_file_id:\s*packages_json/);
    assert.match(localConfigRegistry, /schema_owner:\s*account_apps_packages/);
  });

  it('keeps Desktop Tauri apps projections as Kit-backed materializers only', () => {
    const registryProjection = readRepo('apps/desktop/src-tauri/src/apps_registry_projection.rs');
    const packagesProjection = readRepo('apps/desktop/src-tauri/src/apps_packages_projection.rs');
    const kitPlatformProjection = readRepo('kit/shell/tauri/src/standard_platform_projection.rs');
    const desktopBootstrap = readRepo('apps/desktop/src-tauri/src/main_parts/app_bootstrap.rs');
    const desktopMain = readRepo('apps/desktop/src-tauri/src/main.rs');

    assert.match(registryProjection, /nimi_shell_tauri::capabilities::platform_projection::apps_registry/);
    assert.match(registryProjection, /build_apps_registry_record/);
    assert.match(registryProjection, /materialize_apps_registry_projection/);
    assert.match(registryProjection, /read_apps_registry_projection/);
    assert.doesNotMatch(registryProjection, /struct\s+AppsRegistryRow/);
    assert.doesNotMatch(registryProjection, /PLATFORM_NIMI_APP_REGISTRY_ROWS\s*:/);

    assert.match(packagesProjection, /nimi_shell_tauri::capabilities::platform_projection::apps_packages/);
    assert.match(packagesProjection, /validate_apps_packages_record/);
    assert.match(packagesProjection, /GetAppPackageReadiness/);
    assert.doesNotMatch(packagesProjection, /selected_product_data_root/);
    assert.doesNotMatch(packagesProjection, /install-evidence\.json|build_apps_packages_record_from_runtime_install_evidence/);
    assert.doesNotMatch(packagesProjection, /struct\s+RuntimeInstallEvidence/);
    assert.doesNotMatch(packagesProjection, /const\s+PACKAGE_STATE_/);
    assert.doesNotMatch(packagesProjection, /package\.(?:data_root|cache_root|temp_root|install_root)/);

    assert.match(kitPlatformProjection, /materialize_apps_registry_projection/);
    assert.match(kitPlatformProjection, /build_apps_bridge_projection/);
    assert.match(kitPlatformProjection, /APPS_PACKAGES_POINTER/);
    assert.doesNotMatch(kitPlatformProjection, /ensure_apps_packages/);
    assert.doesNotMatch(kitPlatformProjection, /struct\s+BridgeRegistryRow/);
    assert.doesNotMatch(kitPlatformProjection, /struct\s+BridgeReleaseDescriptorRow/);
    assert.doesNotMatch(kitPlatformProjection, /struct\s+BridgeInstallEvidenceRow/);
    assert.doesNotMatch(kitPlatformProjection, /storage_roots|storageRoots/);
    assert.doesNotMatch(desktopBootstrap, /apps_bridge_projection_get/);
    assert.doesNotMatch(desktopMain, /apps_bridge_projection/);
  });

  it('keeps Desktop renderer Apps as SDK and Runtime consumers', () => {
    const bridgeClient = readRepo(
      'apps/desktop/src/shell/renderer/bridge/runtime-bridge/apps-projection.ts',
    );
    const liveBridge = readRepo('apps/desktop/src/shell/renderer/features/apps/apps-live-bridge.ts');
    const panelProjection = readRepo(
      'apps/desktop/src/shell/renderer/features/apps/apps-panel-projection.ts',
    );
    const lifecycleBridge = readRepo(
      'apps/desktop/src/shell/renderer/features/apps/apps-lifecycle-bridge.ts',
    );

    assert.match(bridgeClient, /parseNimiAppBridgeProjection/);
    assert.match(bridgeClient, /from '@nimiplatform\/sdk\/app'/);
    assert.match(bridgeClient, /getShellPlatformProjection/);
    assert.match(bridgeClient, /projectionId: 'apps-bridge'/);
    assert.doesNotMatch(bridgeClient, /apps_bridge_projection_get/);
    assert.doesNotMatch(bridgeClient, /ADMISSION_STATUSES|RELEASE_DESCRIPTOR_CLASSES|VERIFICATION_STATES/);

    assert.match(liveBridge, /NimiAppClient/);
    assert.match(liveBridge, /createNimiAppRegistryTransport/);
    assert.match(liveBridge, /loadPackageReadiness/);
    assert.match(liveBridge, /getDesktopRuntime\(\)\.appLifecycle\.packageReadiness/);
    assert.doesNotMatch(liveBridge, /loadInstallEvidence/);
    assert.match(liveBridge, /from '@nimiplatform\/sdk\/app'/);

    assert.match(panelProjection, /NimiAppClient/);
    assert.match(panelProjection, /resolveNimiRuntimeAppActiveStorageRoots/);
    assert.doesNotMatch(panelProjection, /nimi-app-registry\.yaml|nimi-app-release-descriptors\.yaml/);
    assert.doesNotMatch(panelProjection, /ADMISSION_STATUSES|RELEASE_DESCRIPTOR_CLASSES|VERIFICATION_STATES/);

    assert.match(lifecycleBridge, /getDesktopRuntime\(\)\.appLifecycle/);
    assert.doesNotMatch(lifecycleBridge, /getPlatformClient\(\)\.runtime\.appLifecycle/);
    assert.match(lifecycleBridge, /NimiRuntimeAppLifecycleClient/);
    assert.doesNotMatch(lifecycleBridge, /invokeChecked|apps_bridge_projection_get|__TAURI__/);
    assert.match(lifecycleBridge, /never returns a fabricated "success" job/);
  });

  it('keeps account app-inventory reads behind the SDK Runtime surface, not Desktop account projection truth', () => {
    const accountProjection = readRepo('apps/desktop/src-tauri/src/account_apps_projection.rs');
    const appBootstrap = readRepo('apps/desktop/src-tauri/src/main_parts/app_bootstrap.rs');
    const appsPanelController = readRepo('apps/desktop/src/shell/renderer/features/apps/apps-panel-controller.ts');
    const appsLiveBridge = readRepo('apps/desktop/src/shell/renderer/features/apps/apps-live-bridge.ts');

    assert.match(appsLiveBridge, /appLifecycle\.accountInventory/);
    assert.match(appsLiveBridge, /appLifecycle\.listLocalAdoptions/);
    assert.doesNotMatch(appBootstrap, /account_app_inventory_/);
    assert.doesNotMatch(accountProjection, /inventory\.json|AccountAppInventory|write_app_inventory_record/);
    assert.doesNotMatch(appsPanelController, /desktopAppLibraryBridge\.apply|AccountAppLibraryMutationKind/);
    assert.doesNotMatch(accountProjection, /PLATFORM_NIMI_APP_REGISTRY_ROWS/);
    assert.doesNotMatch(accountProjection, /nimi-app-registry\.yaml/);
  });

});
