import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

function readRepo(path: string): string {
  return readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8');
}

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

    assert.doesNotMatch(registryTable, /package_kind:\s*(public-mod|extension)\b/);
    assert.doesNotMatch(releaseDescriptors, /package_kind:\s*(public-mod|extension)\b/);
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
    const bridgeProjection = readRepo('apps/desktop/src-tauri/src/apps_bridge_projection.rs');

    assert.match(registryProjection, /nimi_shell_tauri::platform_projection::apps_registry/);
    assert.match(registryProjection, /build_apps_registry_record/);
    assert.match(registryProjection, /validate_apps_registry_record/);
    assert.doesNotMatch(registryProjection, /struct\s+AppsRegistryRow/);
    assert.doesNotMatch(registryProjection, /PLATFORM_NIMI_APP_REGISTRY_ROWS\s*:/);

    assert.match(packagesProjection, /nimi_shell_tauri::platform_projection::apps_packages/);
    assert.match(packagesProjection, /build_apps_packages_record_from_runtime_install_evidence/);
    assert.match(packagesProjection, /validate_apps_packages_record/);
    assert.match(packagesProjection, /selected_product_data_root/);
    assert.doesNotMatch(packagesProjection, /struct\s+RuntimeInstallEvidence/);
    assert.doesNotMatch(packagesProjection, /const\s+PACKAGE_STATE_/);

    assert.match(bridgeProjection, /ensure_apps_registry/);
    assert.match(bridgeProjection, /ensure_apps_packages/);
    assert.match(bridgeProjection, /build_shared_apps_bridge_projection/);
    assert.doesNotMatch(bridgeProjection, /struct\s+BridgeRegistryRow/);
    assert.doesNotMatch(bridgeProjection, /struct\s+BridgeReleaseDescriptorRow/);
    assert.doesNotMatch(bridgeProjection, /struct\s+BridgeInstallEvidenceRow/);
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
    assert.match(bridgeClient, /apps_bridge_projection_get/);
    assert.doesNotMatch(bridgeClient, /ADMISSION_STATUSES|RELEASE_DESCRIPTOR_CLASSES|VERIFICATION_STATES/);

    assert.match(liveBridge, /NimiAppClient/);
    assert.match(liveBridge, /createNimiAppRegistryTransport/);
    assert.match(liveBridge, /from '@nimiplatform\/sdk\/app'/);

    assert.match(panelProjection, /NimiAppClient/);
    assert.match(panelProjection, /resolveRuntimeAppActiveStorageRoots/);
    assert.doesNotMatch(panelProjection, /nimi-app-registry\.yaml|nimi-app-release-descriptors\.yaml/);
    assert.doesNotMatch(panelProjection, /ADMISSION_STATUSES|RELEASE_DESCRIPTOR_CLASSES|VERIFICATION_STATES/);

    assert.match(lifecycleBridge, /getPlatformClient\(\)\.runtime\.appLifecycle/);
    assert.match(lifecycleBridge, /RuntimeAppLifecycleModule/);
    assert.doesNotMatch(lifecycleBridge, /invokeChecked|apps_bridge_projection_get|__TAURI__/);
    assert.match(lifecycleBridge, /never returns a fabricated "success" job/);
  });

  it('keeps account app-library residue local to Desktop account projection, not admission truth', () => {
    const accountProjection = readRepo('apps/desktop/src-tauri/src/account_apps_projection.rs');
    const accountCommands = readRepo('apps/desktop/src-tauri/src/account_apps_library_commands.rs');

    assert.match(accountProjection, /account app-library projection/);
    assert.match(accountProjection, /read_account_app_library_governed/);
    assert.match(accountProjection, /apply_account_app_library_mutation/);
    assert.match(accountCommands, /authenticated_runtime_account_id/);
    assert.doesNotMatch(accountProjection, /PLATFORM_NIMI_APP_REGISTRY_ROWS/);
    assert.doesNotMatch(accountProjection, /nimi-app-registry\.yaml/);
    assert.doesNotMatch(accountCommands, /account_id:\s*String/);
  });

  it('proves Tester is a second SDK consumer, not a Desktop projection fork', () => {
    const testerSettings = readRepo('apps/tester/src/shell/routes/settings.tsx');
    const testerContract = readRepo('apps/tester/test/tester-contract.test.mjs');
    const testerScaffoldContract = readRepo('apps/tester/test/scaffold-boundary.test.mjs');
    const testerTauriMain = readRepo('apps/tester/src-tauri/src/main.rs');

    assert.match(testerSettings, /parseNimiAppBridgeProjection/);
    assert.match(testerSettings, /parseAccountAppLibraryRecord/);
    assert.match(testerSettings, /from '@nimiplatform\/sdk\/app'/);
    assert.match(testerContract, /tester settings consumes SDK Nimi App bridge projection parser/);
    assert.match(testerScaffoldContract, /ADMISSION\.md/);
    assert.doesNotMatch(testerSettings, /ADMISSION_STATUSES|RELEASE_DESCRIPTOR_CLASSES|VERIFICATION_STATES/);
    assert.doesNotMatch(testerSettings, /apps\/desktop/);
    assert.match(testerTauriMain, /nimi_shell_tauri::platform_projection::apps_bridge/);
  });

  it('keeps SDK app read projection separate from Runtime app lifecycle mutation', () => {
    const sdkAppClient = readRepo('sdk/src/app/client.ts');
    const sdkAppTransport = readRepo('sdk/src/app/transport.ts');
    const sdkRuntimeLifecycle = readRepo('sdk/src/runtime/runtime-app-lifecycle.ts');

    assert.match(sdkAppClient, /NimiAppClient/);
    assert.match(sdkAppClient, /runtime\.appLifecycle/);
    assert.doesNotMatch(sdkAppClient, /\b(?:install|uninstall|update|repair|open)\s*\(/);
    assert.match(sdkAppTransport, /pure read-projection surface/);
    assert.doesNotMatch(sdkAppTransport, /\b(?:install|uninstall|update|repair|open)\s*\(/);

    assert.match(sdkRuntimeLifecycle, /RuntimeAppLifecycleModule/);
    assert.match(sdkRuntimeLifecycle, /\binstall\(/);
    assert.match(sdkRuntimeLifecycle, /\buninstall\(/);
    assert.match(sdkRuntimeLifecycle, /\bopen\(/);
  });
});
