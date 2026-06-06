import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const repoRoot = path.resolve(import.meta.dirname, '../../..');

function read(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function readRustModule(entryRelativePath: string, dirRelativePath: string): string {
  const dir = path.join(repoRoot, dirRelativePath);
  const moduleFiles = fs.existsSync(dir)
    ? fs.readdirSync(dir)
      .filter((name) => name.endsWith('.rs'))
      .sort()
      .map((name) => read(path.join(dirRelativePath, name)))
    : [];
  return [read(entryRelativePath), ...moduleFiles].join('\n');
}

test('Desktop consumes factory AIProfile projections without owning catalog rows', () => {
  const desktopFactoryIndex = read('apps/desktop/src-tauri/src/factory_profile_index.rs');
  const firstRunWorkflow = read('apps/desktop/src/shell/renderer/first-run/product-control-workflow.tsx');

  assert.match(desktopFactoryIndex, /build_factory_profile_index_record/);
  assert.match(desktopFactoryIndex, /materialize_factory_profile_index_projection/);
  assert.doesNotMatch(desktopFactoryIndex, /PlatformAIProfileFactoryRow\s*\{/);

  assert.match(firstRunWorkflow, /from '@nimiplatform\/sdk\/app'/);
  assert.match(firstRunWorkflow, /loadNimiAppAIProfileFactoryRows/);
  assert.match(firstRunWorkflow, /selectNimiAppFactoryAIProfileForFirstRun/);
  assert.doesNotMatch(firstRunWorkflow, /install-level-policy/);
});

test('built-in first-run AIConfig evidence is Desktop host placement over canonical scopes', () => {
  const desktopAiConfigLibrary = readRustModule(
    'apps/desktop/src-tauri/src/desktop_ai_config_library.rs',
    'apps/desktop/src-tauri/src/desktop_ai_config_library',
  );
  const productControl = readRustModule(
    'apps/desktop/src-tauri/src/desktop_product_control.rs',
    'apps/desktop/src-tauri/src/desktop_product_control',
  );
  const appBootstrap = read('apps/desktop/src-tauri/src/main_parts/app_bootstrap.rs');
  const runtimeBootstrap = read('apps/desktop/src/shell/renderer/infra/bootstrap/runtime-bootstrap.ts');
  const runtimeSlice = read('apps/desktop/src/shell/renderer/app-shell/providers/runtime-slice.ts');
  const productControlSchema = read('.nimi/spec/platform/kernel/tables/product-control-record-schema.yaml');

  assert.match(desktopAiConfigLibrary, /BUILT_IN_CHAT_SURFACE_IDS: &\[&str\] = &\["nimi", "agent"\]/);
  assert.match(desktopAiConfigLibrary, /BUILT_IN_AI_CONFIG_SCOPE_KIND: &str = "feature"/);
  assert.match(desktopAiConfigLibrary, /BUILT_IN_AI_CONFIG_SCOPE_OWNER_ID: &str = "desktop\.chat"/);
  for (const requiredProjectionField of [
    /pub scope_ref: BuiltInChatScopeRef,/,
    /pub ai_profile_ref: BuiltInAiProfileRef,/,
    /pub ai_config_version: u64,/,
    /pub ai_config_content_hash: String,/,
    /pub writer_identity: String,/,
    /pub committed_at: String,/,
  ]) {
    assert.match(desktopAiConfigLibrary, requiredProjectionField);
  }
  assert.match(desktopAiConfigLibrary, /verify_first_run_factory_ai_profile/);
  assert.match(desktopAiConfigLibrary, /runtime_capability_bindings_from_execution_evidence_ref/);
  assert.match(desktopAiConfigLibrary, /with_extension\(format!\("json\.tmp/);
  assert.match(desktopAiConfigLibrary, /fs::rename\(&tmp_path, path\)/);

  assert.match(productControl, /RUNTIME_LOCAL_RECORD_PRODUCT_CONTROL_FIRST_RUN_LOCAL_AI_READY_EVIDENCE_METHOD_ID/);
  assert.match(productControl, /built_in_ai_config_evidence_json: to_json\(&evidence_set/);
  assert.match(productControl, /resolve_built_in_ai_config_refs_for_admission/);
  assert.match(productControl, /string-only ref/);
  assert.match(productControl, /recorded set is partial/);
  assert.doesNotMatch(productControl, /product_control_record_mark_ready_for_use/);
  assert.doesNotMatch(appBootstrap, /product_control_record_ensure_built_in_ai_config/);

  assert.doesNotMatch(runtimeSlice, /initializeBuiltInChatScopeFromProductControl|createBuiltInChatAIScopeRef/);
  assert.match(runtimeBootstrap, /initializeBuiltInChatScopesAfterReadyAdmission/);
  assert.match(runtimeBootstrap, /initializeBuiltInChatScopesFromProductControl/);
  assert.match(runtimeBootstrap, /projection\.state !== 'ready_for_use'/);

  assert.match(productControlSchema, /builtInAiConfigRefs:/);
  assert.match(productControlSchema, /owner: desktop_chat_feature_scope_owner/);
  assert.match(productControlSchema, /verifier: Desktop host AIConfig authority plus SDK Runtime \/ Kit projection from Runtime executionEvidenceRef proof/);
});

test('Account Default Profile library is account-local evidence, not scope AIConfig mutation', () => {
  const localConfigRegistry = read('.nimi/spec/platform/kernel/tables/local-config-file-registry.yaml');
  const policy = read('.nimi/spec/platform/kernel/ai-profile-selection-policy-contract.md');
  const accountProfileLibrary = readRustModule(
    'apps/desktop/src-tauri/src/account_profile_library.rs',
    'apps/desktop/src-tauri/src/account_profile_library',
  );
  const accountProfileFiles = readRustModule(
    'apps/desktop/src-tauri/src/account_profile_library_files.rs',
    'apps/desktop/src-tauri/src/account_profile_library_files',
  );
  const accountProfileBridge = read('apps/desktop/src/shell/renderer/bridge/runtime-bridge/account-profile-library.ts');
  const profilePage = read('apps/desktop/src/shell/renderer/features/runtime-config/runtime-config-page-profiles.tsx');
  const profileLibraryStore = read('apps/desktop/src/shell/renderer/features/runtime-config/runtime-config-profile-library.ts');

  assert.doesNotMatch(localConfigRegistry, /schema_owner: account_profile_library/);
  assert.match(policy, /Account Default Profile 是 account-scoped local AI profile library default/);

  assert.match(accountProfileLibrary, /account_default_profile_path/);
  assert.match(accountProfileLibrary, /~\/\.nimi\/accounts\/<account-id>\/profiles\/default\.json/);
  assert.match(accountProfileLibrary, /verify_first_run_factory_ai_profile/);
  assert.match(accountProfileLibrary, /data_root_ref/);
  assert.match(accountProfileLibrary, /factory seed AIProfile payload/);
  const accountProfileImports = accountProfileLibrary
    .split('\n')
    .filter((line) => line.trimStart().startsWith('use '))
    .join('\n');
  assert.doesNotMatch(accountProfileImports, /realm|oauth/i);

  assert.match(accountProfileFiles, /create_account_profile_library_entry/);
  assert.match(accountProfileFiles, /import_account_profile_library_entries/);
  assert.match(accountProfileFiles, /export_account_profile_library_entries/);
  assert.doesNotMatch(accountProfileFiles, /aiConfig|aiProfile\.apply/);

  assert.match(accountProfileBridge, /from '@nimiplatform\/sdk\/ai'/);
  assert.match(accountProfileBridge, /parseNimiAccountProfileLibraryProjection/);
  assert.match(accountProfileBridge, /parseExportedNimiAccountProfileLibraryProfiles/);
  assert.doesNotMatch(accountProfileBridge, /localStorage|sessionStorage/);

  assert.match(profilePage, /ModelConfigAiModelHub/);
  assert.match(profilePage, /useModelConfigProfileController/);
  assert.match(profilePage, /getAccountDefaultProfileForScopeInit/);
  assert.match(profilePage, /profile\.onApply\(accountDefault\.profileId\)/);
  assert.doesNotMatch(profilePage, /aiConfigService\.aiProfile\.apply\(/);
  assert.doesNotMatch(profilePage, /aiConfigService\.aiConfig\.update\(/);

  assert.match(profileLibraryStore, /adoptProjection/);
  assert.match(profileLibraryStore, /single source of truth/);
  assert.doesNotMatch(profileLibraryStore, /aiConfig/i);
  assert.doesNotMatch(profileLibraryStore, /aiProfile\.apply/);
});

test('Desktop consumes SDK and Kit AIProfile surfaces as an app', () => {
  const desktopProfilePage = read('apps/desktop/src/shell/renderer/features/runtime-config/runtime-config-page-profiles.tsx');
  const desktopChatSettings = read('apps/desktop/src/shell/renderer/features/chat/chat-shared-settings-panel.tsx');

  assert.match(desktopProfilePage, /from '@nimiplatform\/sdk\/ai'/);
  assert.match(desktopProfilePage, /from '@nimiplatform\/kit\/features\/model-config'/);
  assert.doesNotMatch(desktopProfilePage, /applyAIProfileToConfig/);
  assert.match(desktopChatSettings, /from '@nimiplatform\/kit\/features\/model-config'/);
});
