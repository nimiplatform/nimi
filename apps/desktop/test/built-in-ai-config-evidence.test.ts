import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const desktopAiConfigLibrarySource = readFileSync(
  resolve(import.meta.dirname, '../src-tauri/src/desktop_ai_config_library.rs'),
  'utf8',
);
const desktopAiConfigLibraryDir = resolve(
  import.meta.dirname,
  '../src-tauri/src/desktop_ai_config_library',
);
const desktopAiConfigLibraryModuleSource = [
  desktopAiConfigLibrarySource,
  ...readdirSync(desktopAiConfigLibraryDir)
    .filter((name) => name.endsWith('.rs'))
    .sort()
    .map((name) => readFileSync(resolve(desktopAiConfigLibraryDir, name), 'utf8')),
].join('\n');
const desktopProductControlDir = resolve(
  import.meta.dirname,
  '../src-tauri/src/desktop_product_control',
);
const desktopProductControlSource = [
  readFileSync(
    resolve(import.meta.dirname, '../src-tauri/src/desktop_product_control.rs'),
    'utf8',
  ),
  ...readdirSync(desktopProductControlDir)
    .filter((name) => name.endsWith('.rs'))
    .sort()
    .map((name) => readFileSync(resolve(desktopProductControlDir, name), 'utf8')),
].join('\n');
const appBootstrapSource = readFileSync(
  resolve(import.meta.dirname, '../src-tauri/src/main_parts/app_bootstrap.rs'),
  'utf8',
);
const mainSource = readFileSync(
  resolve(import.meta.dirname, '../src-tauri/src/main.rs'),
  'utf8',
);
const productControlSchemaSource = readFileSync(
  resolve(
    import.meta.dirname,
    '../../../.nimi/spec/platform/kernel/tables/product-control-record-schema.yaml',
  ),
  'utf8',
);
const rendererRuntimeSliceSource = readFileSync(
  resolve(
    import.meta.dirname,
    '../src/shell/renderer/app-shell/providers/runtime-slice.ts',
  ),
  'utf8',
);
const rendererRuntimeBootstrapSource = readFileSync(
  resolve(
    import.meta.dirname,
    '../src/shell/renderer/infra/bootstrap/runtime-bootstrap.ts',
  ),
  'utf8',
);
const desktopAuthAdapterSource = readFileSync(
  resolve(
    import.meta.dirname,
    '../src/shell/renderer/features/auth/desktop-auth-adapter.ts',
  ),
  'utf8',
);

test('built-in AIConfig local writer module is registered', () => {
  assert.match(mainSource, /mod desktop_ai_config_library;/);
  assert.match(
    desktopAiConfigLibrarySource,
    /BUILT_IN_AI_CONFIG_WRITER_IDENTITY: &str = "desktop_host_ai_config_service"/,
  );
});

test('built-in AIConfig evidence binds all five required_projection fields (D-AIPC-013)', () => {
  // required_projection: scopeRef, aiProfileRef_or_hash, aiConfigVersion_or_hash,
  // writer_identity, committedAt.
  for (const field of [
    /pub scope_ref: BuiltInChatScopeRef,/,
    /pub ai_profile_ref: BuiltInAiProfileRef,/,
    /pub ai_config_version: u64,/,
    /pub ai_config_content_hash: String,/,
    /pub writer_identity: String,/,
    /pub committed_at: String,/,
  ]) {
    assert.match(desktopAiConfigLibraryModuleSource, field);
  }
});

test('built-in AIConfig only admits the two canonical P-AISC-006 feature scopes', () => {
  assert.match(
    desktopAiConfigLibrarySource,
    /BUILT_IN_CHAT_SURFACE_IDS: &\[&str\] = &\["nimi", "agent"\]/,
  );
  assert.match(
    desktopAiConfigLibrarySource,
    /BUILT_IN_AI_CONFIG_SCOPE_KIND: &str = "feature"/,
  );
  assert.match(
    desktopAiConfigLibrarySource,
    /BUILT_IN_AI_CONFIG_SCOPE_OWNER_ID: &str = "desktop\.chat"/,
  );
});

test('built-in AIConfig fails closed on generic scope, string-only ref, and partial set', () => {
  // generic / merged feature scope is rejected.
  assert.match(desktopAiConfigLibraryModuleSource, /must be the feature shape, not a generic app scope/);
  // string-only refs and partial one-of-two sets are rejected at the admission seams.
  assert.match(desktopProductControlSource, /string-only ref/);
  assert.match(desktopProductControlSource, /recorded set is partial/);
  assert.match(desktopAiConfigLibraryModuleSource, /string_only_and_missing_refs_fail_closed/);
  assert.match(desktopAiConfigLibraryModuleSource, /partial_one_of_two_built_in_set_fails_closed/);
  // Text/STT/TTS bindings come from Runtime execution evidence; no capability
  // binding is invented when Runtime omits a selected execution proof.
  assert.match(desktopAiConfigLibraryModuleSource, /runtime_capability_bindings_from_execution_evidence_ref/);
  assert.match(desktopAiConfigLibraryModuleSource, /project_first_run_execution_evidence_to_ai_config_bindings/);
  assert.doesNotMatch(desktopAiConfigLibraryModuleSource, /RuntimeBaselineActivationConsumerEvidence/);
});

test('built-in AIConfig apply is atomic (D-AIPC-005) via temp-file then rename', () => {
  assert.match(desktopAiConfigLibrarySource, /with_extension\(format!\("json\.tmp/);
  assert.match(desktopAiConfigLibrarySource, /fs::rename\(&tmp_path, path\)/);
});

test('product control materializes built-in AIConfig refs inside first-run finalization', () => {
  assert.match(
    desktopProductControlSource,
    /prepare_first_run_local_ai_ready_for_product_control/,
  );
  assert.match(
    desktopProductControlSource,
    /ensure_built_in_ai_config_evidence_set/,
  );
  assert.match(
    desktopProductControlSource,
    /RecordProductControlFirstRunLocalAiReadyEvidenceRequest/,
  );
  assert.match(
    desktopProductControlSource,
    /built_in_ai_config_evidence_json: to_json\(&evidence_set, "built-in AIConfig evidence"\)\?/,
  );
  // wave-6 resolve/verify seam exists and does NOT write ready_for_use.
  assert.match(
    desktopProductControlSource,
    /pub fn resolve_built_in_ai_config_refs_for_admission/,
  );
  assert.doesNotMatch(desktopProductControlSource, /product_control_record_mark_ready_for_use/);
  // The one-off built-in AIConfig command is no longer separately exposed;
  // first-run finalization materializes the refs through prepare_local_ai_ready.
  assert.doesNotMatch(
    appBootstrapSource,
    /product_control_record_ensure_built_in_ai_config/,
  );
});

test('product-control schema keeps builtInAiConfigRefs owned by desktop chat feature scopes through SDK projection', () => {
  assert.match(productControlSchemaSource, /builtInAiConfigRefs:/);
  assert.match(productControlSchemaSource, /owner: desktop_chat_feature_scope_owner/);
  assert.match(productControlSchemaSource, /verifier: Desktop host AIConfig authority plus SDK Runtime \/ Kit projection from Runtime executionEvidenceRef proof/);
  for (const scope of [/surfaceId: nimi/, /surfaceId: agent/]) {
    assert.match(productControlSchemaSource, scope);
  }
  for (const projection of [
    /- scopeRef/,
    /- aiProfileRef_or_hash/,
    /- aiConfigVersion_or_hash/,
    /- writer_identity/,
    /- committedAt/,
  ]) {
    assert.match(productControlSchemaSource, projection);
  }
});

test('built-in AIConfig renderer init waits for Runtime account projection and product readiness', () => {
  assert.doesNotMatch(
    rendererRuntimeSliceSource,
    /initializeBuiltInChatScopeFromProductControl|createBuiltInChatAIScopeRef/,
    'runtime slice construction must not call Runtime-owned built-in AIConfig init before account projection exists',
  );
  const accountProjectionIndex = rendererRuntimeBootstrapSource.indexOf('const accountProjection = accountStatus?.accountProjection;');
  const productGateIndex = rendererRuntimeBootstrapSource.indexOf('initializeBuiltInChatScopesAfterReadyAdmission(flowId)');
  const initIndex = rendererRuntimeBootstrapSource.indexOf('initializeBuiltInChatScopesFromProductControl()');
  const watcherIndex = rendererRuntimeBootstrapSource.indexOf('startAuthStateWatcher(lifecycle);');
  assert.ok(accountProjectionIndex !== -1, 'Runtime account projection must be read');
  assert.ok(productGateIndex !== -1, 'bootstrap must gate built-in AIConfig init through product readiness');
  assert.ok(initIndex !== -1, 'built-in AIConfig init must run from bootstrap');
  assert.ok(watcherIndex !== -1, 'auth watcher must still start');
  assert.ok(
    accountProjectionIndex < productGateIndex,
    'built-in AIConfig product gate must wait until Runtime account projection exists',
  );
  assert.ok(
    productGateIndex < watcherIndex,
    'initial built-in AIConfig init should finish or defer before auth watcher startup',
  );
  assert.match(rendererRuntimeBootstrapSource, /if \(projection\.state !== 'ready_for_use'\) \{[\s\S]*return;/);
  assert.match(rendererRuntimeBootstrapSource, /message: 'phase:built-in-ai-config:init-skipped-product-not-ready'/);
  assert.match(
    rendererRuntimeBootstrapSource,
    /if \(accountStatus\?\.state === 'authenticated' && accountProjection\?\.accountId\) \{[\s\S]*initializeBuiltInChatScopesAfterReadyAdmission\(flowId\)/,
  );
  assert.match(rendererRuntimeBootstrapSource, /message: 'phase:built-in-ai-config:init-deferred'/);
});

test('desktop post-login sync initializes built-in chat AIConfig without full rebootstrap', () => {
  assert.match(desktopAuthAdapterSource, /syncDesktopBuiltInChatAIConfigAfterLogin/);
  assert.match(desktopAuthAdapterSource, /desktopBridge\.getProductControlRecord\(\)/);
  assert.match(desktopAuthAdapterSource, /if \(projection\.state !== 'ready_for_use'\)/);
  assert.match(desktopAuthAdapterSource, /initializeBuiltInChatScopesFromProductControl\(\)/);
  assert.match(desktopAuthAdapterSource, /refreshConversationCapabilityProjections\(productionAppStore, \['text\.generate'\]\)/);
  const completeStart = desktopAuthAdapterSource.indexOf('complete: async (request: Parameters<typeof broker.complete>[0]) => {');
  assert.notEqual(completeStart, -1, 'desktop Runtime account browser broker complete handler must exist');
  const completeEnd = desktopAuthAdapterSource.indexOf('\n    },', completeStart);
  assert.doesNotMatch(
    desktopAuthAdapterSource.slice(completeStart, completeEnd),
    /rebootstrapRuntime|bootstrapRuntime/,
    'post-login built-in AIConfig sync must not reintroduce full bootstrap into auth completion',
  );
});
