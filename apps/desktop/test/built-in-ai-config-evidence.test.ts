import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const desktopAiConfigLibrarySource = readFileSync(
  resolve(import.meta.dirname, '../src-tauri/src/desktop_ai_config_library.rs'),
  'utf8',
);
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

test('built-in AIConfig owner is the Desktop host AIConfig service module and is registered', () => {
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
    assert.match(desktopAiConfigLibrarySource, field);
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
  assert.match(desktopAiConfigLibrarySource, /must be the feature shape, not a generic app scope/);
  // string-only / caller-provided refs are rejected.
  assert.match(
    desktopAiConfigLibrarySource,
    /built-in AIConfig ref is caller-provided, stale, or string-only/,
  );
  // a partial one-of-two set is rejected.
  assert.match(
    desktopAiConfigLibrarySource,
    /requires exactly \{\} refs for both canonical chat scopes/,
  );
  // text.generate binding comes from Runtime baseline evidence; non-text
  // capabilities stay explicitly unbound instead of hardcoding a provider/model.
  assert.match(desktopAiConfigLibrarySource, /runtime_text_generate_binding_from_baseline_ref/);
  assert.match(desktopAiConfigLibrarySource, /capability == TEXT_GENERATE_CAPABILITY/);
});

test('built-in AIConfig apply is atomic (D-AIPC-005) via temp-file then rename', () => {
  assert.match(desktopAiConfigLibrarySource, /with_extension\(format!\("json\.tmp/);
  assert.match(desktopAiConfigLibrarySource, /fs::rename\(&tmp_path, path\)/);
});

test('product control materializes built-in AIConfig refs and exposes the wave-6 resolve seam', () => {
  assert.match(
    desktopProductControlSource,
    /ensure_built_in_ai_config_for_product_control/,
  );
  assert.match(
    desktopProductControlSource,
    /record\.first_run\.built_in_ai_config_refs = evidence_set\.refs\(\)/,
  );
  // wave-6 resolve/verify seam exists and does NOT write ready_for_use.
  assert.match(
    desktopProductControlSource,
    /pub fn resolve_built_in_ai_config_refs_for_admission/,
  );
  assert.doesNotMatch(desktopProductControlSource, /product_control_record_mark_ready_for_use/);
  // tauri command is registered.
  assert.match(
    appBootstrapSource,
    /product_control_record_ensure_built_in_ai_config/,
  );
});

test('product-control schema keeps builtInAiConfigRefs owned by the Desktop host AIConfig service', () => {
  assert.match(productControlSchemaSource, /builtInAiConfigRefs:/);
  assert.match(productControlSchemaSource, /owner: desktop_host_ai_config_service/);
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
