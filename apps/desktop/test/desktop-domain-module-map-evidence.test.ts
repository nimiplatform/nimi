import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const repoRoot = path.join(import.meta.dirname, '../../..');

function readRepo(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function assertRepoFile(relativePath: string): void {
  assert.ok(fs.existsSync(path.join(repoRoot, relativePath)), `${relativePath} should exist`);
}

function listRepoFiles(relativePath: string): string[] {
  const absolutePath = path.join(repoRoot, relativePath);
  if (!fs.existsSync(absolutePath)) {
    return [];
  }

  const files: string[] = [];
  const visit = (directoryPath: string): void => {
    for (const entry of fs.readdirSync(directoryPath, { withFileTypes: true })) {
      const entryPath = path.join(directoryPath, entry.name);
      if (entry.isDirectory()) {
        visit(entryPath);
        continue;
      }
      if (entry.isFile()) {
        files.push(entryPath);
      }
    }
  };

  visit(absolutePath);
  return files.sort();
}

const bridgeIpcSpec = readRepo('.nimi/spec/desktop/kernel/bridge-ipc-contract.md');
const gitIgnoreSource = readRepo('.gitignore');
const productControlSource = readRepo('apps/desktop/src-tauri/src/desktop_product_control.rs');
const productControlOperationsSource = readRepo('apps/desktop/src-tauri/src/desktop_product_control/operations.rs');
const productControlAdmissionSource = readRepo('apps/desktop/src-tauri/src/desktop_product_control_admission.rs');
const avatarInstanceRegistryStoreSource = readRepo('apps/desktop/src-tauri/src/desktop_avatar_instance_registry/store.rs');
const desktopE2eFixtureSource = readRepo('apps/desktop/src-tauri/src/desktop_e2e_fixture.rs');
const desktopE2eFixtureEnabledSource = readRepo('apps/desktop/src-tauri/src/desktop_e2e_fixture/enabled.rs');
const runtimeBridgeSource = readRepo('kit/shell/tauri/src/runtime_bridge/mod.rs');
const realmSourceDetailDataSource = readRepo('apps/desktop/src/shell/renderer/features/source-detail/data/realm-source-detail-data.ts');
const runtimePageSource = readRepo('apps/desktop/src/shell/renderer/features/runtime-config/runtime-config-page-runtime.tsx');
const settingsPagesSource = readRepo('apps/desktop/src/shell/renderer/features/settings/settings-pages.tsx');

test('Source Detail module map resolves to live Realm source feature-data evidence', () => {
  assert.match(realmSourceDetailDataSource, /export async function loadRealmSourceDetailsForDisplay/);
  assertRepoFile('apps/desktop/src/shell/renderer/features/source-detail/data/realm-source-detail-data.ts');
  assert.equal(
    fs.existsSync(path.join(repoRoot, 'apps/desktop/src/shell/renderer/features/world/data/runtime-source-create-data.ts')),
    false,
  );
});

test('Source Detail materializes Realm source through sourceRef packet admission', () => {
  const panelSource = readRepo('apps/desktop/src/shell/renderer/features/source-detail/source-detail-panel.tsx');
  const viewSource = readRepo('apps/desktop/src/shell/renderer/features/source-detail/source-detail-view.tsx');

  assert.doesNotMatch(panelSource, /launchAgentConversationFromDisplay/);
  const legacyLaunchPattern = new RegExp(`launch${['Realm', 'Agent'].join('')}Chat|launch${['Realm', 'Agent'].join('')}Conversation`);
  const legacyOpenPattern = new RegExp(`open${['Realm', 'Agent'].join('')}LocalChat`);
  assert.doesNotMatch(panelSource, legacyLaunchPattern);
  assert.doesNotMatch(panelSource, legacyOpenPattern);
  assert.match(panelSource, /materializeSourceContactLaunchTarget/);
  assert.match(panelSource, /ensureRuntimeAgentExists/);
  assert.match(panelSource, /realmPersonaSourceMaterializationMessage/);
  assert.doesNotMatch(panelSource, /realmPersonaSourceHandoffMessage/);
  assert.doesNotMatch(panelSource, new RegExp(`connect${['Realm', 'Persona', 'Source'].join('')}`));
  assert.doesNotMatch(panelSource, /realmPersonaSourceAdmissionQueryKey/);

  assert.doesNotMatch(viewSource, /onOpenChat/);
  assert.match(viewSource, /describeRealmPersonaPrimaryAction/);
  assert.doesNotMatch(viewSource, legacyLaunchPattern);
});

test('Economy Wallet module map resolves to the current settings wallet page', () => {
  assert.match(settingsPagesSource, /from '\.\/settings-advanced-panel\.js'/);
  assert.doesNotMatch(settingsPagesSource, /settings\/panels\/advanced-panel/);
  assertRepoFile('apps/desktop/src/shell/renderer/features/settings/settings-advanced-panel.tsx');
});

test('External Agent module map admits the Access panel evidence', () => {
  assert.match(runtimePageSource, /from '\.\/runtime-config-external-agent-access'/);
  assertRepoFile('apps/desktop/src/shell/renderer/features/runtime-config/runtime-config-external-agent-access.tsx');
});

test('Home module map resolves Feed outside the retired dataSync facade', () => {
  assertRepoFile('apps/desktop/src/shell/renderer/features/social/data/post-feed-data.ts');
});

test('Desktop runtime bridge commands resolve through the shared Tauri shell authority', () => {
  const mainSource = readRepo('apps/desktop/src-tauri/src/main.rs');

  assert.match(bridgeIpcSpec, /kit\/shell\/tauri\/\*\*/);
  assert.match(mainSource, /use nimi_shell_tauri::capabilities::runtime as runtime_bridge;/);
  assert.doesNotMatch(mainSource, /\bmod runtime_bridge\b/);
  assert.deepEqual(listRepoFiles('apps/desktop/src-tauri/src/runtime_bridge'), []);
  assert.doesNotMatch(gitIgnoreSource, /apps\/desktop\/src-tauri\/src\/runtime_bridge/);
  for (const source of [
    productControlSource,
    productControlOperationsSource,
    productControlAdmissionSource,
    avatarInstanceRegistryStoreSource,
  ]) {
    assert.doesNotMatch(source, /base64::engine::general_purpose|request_bytes_base64|response_bytes_base64/);
  }
  assert.match(productControlSource, /product_control_runtime_bridge_metadata/);
  assert.match(productControlSource, /app_id: Some\(DESKTOP_RUNTIME_APP_ID\.to_string\(\)\)/);
  assert.match(productControlOperationsSource, /crate::runtime_bridge::invoke_unary_typed_with_metadata/);
  assert.match(productControlAdmissionSource, /crate::runtime_bridge::invoke_unary_typed_with_metadata/);
  assert.match(avatarInstanceRegistryStoreSource, /crate::runtime_bridge::invoke_unary_typed_with_metadata/);
  assert.ok(!fs.existsSync(path.join(repoRoot, 'apps/desktop/src-tauri/src/account_apps_library_commands.rs')));
  assert.match(runtimeBridgeSource, /RUNTIME_APP_GET_ACCOUNT_APP_INVENTORY_METHOD_ID/);
  assert.doesNotMatch(desktopE2eFixtureSource, /"\/nimi\.runtime\.v1\./);
  assert.match(desktopE2eFixtureSource, /feature = "desktop-e2e-fixture"/);
  assert.match(desktopE2eFixtureEnabledSource, /RUNTIME_AUTH_REGISTER_APP_METHOD_ID/);
  assertRepoFile('kit/shell/tauri/src/runtime_bridge/mod.rs');
});
