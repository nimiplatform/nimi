import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const sourcePath = path.join(
  import.meta.dirname,
  '../src/shell/renderer/features/runtime-config/runtime-config-page-profiles.tsx',
);

// T2.4: the Profiles section converges onto the Nimi Kit AI Config component.
// Profile apply is preview-gated (D-AIPC-014 / S-AICONF-008) through the kit
// `useModelConfigProfileController` controller — the bespoke direct-apply path
// is retired. There is no immediate-commit apply on this surface.

test('profile section delegates apply to the kit preview-gated controller', () => {
  const source = readFileSync(sourcePath, 'utf8');
  // Apply flows through the canonical kit hub + controller, not a bespoke path.
  assert.match(source, /useModelConfigProfileController/);
  assert.match(source, /ModelConfigAiModelHub/);
  // No bespoke immediate-commit apply: the retired direct `aiProfile.apply`
  // call and renderer-authored `aiConfig.update` must not return.
  assert.doesNotMatch(source, /surface\.aiProfile\.apply\(scopeRef, profileId\)/);
  assert.doesNotMatch(source, /surface\.aiConfig\.update\(scopeRef/);
});

test('profile section retires the bespoke profile editor', () => {
  const source = readFileSync(sourcePath, 'utf8');
  assert.doesNotMatch(source, /from '\.\/runtime-config-profile-editor/);
  // The retired editor component module must no longer exist.
  const editorPath = path.join(
    import.meta.dirname,
    '../src/shell/renderer/features/runtime-config/runtime-config-profile-editor.tsx',
  );
  assert.equal(
    (() => { try { readFileSync(editorPath); return true; } catch { return false; } })(),
    false,
    'runtime-config-profile-editor.tsx must be deleted',
  );
});

test('profile section exposes the file-backed library actions and factory restore', () => {
  const source = readFileSync(sourcePath, 'utf8');
  assert.match(source, /runtime-profiles-account-library/);
  assert.match(source, /runtime-profiles-create/);
  assert.match(source, /runtime-profiles-import/);
  assert.match(source, /runtime-profiles-export/);
  assert.match(source, /runtime-profiles-factory-restore/);
  // Factory-restore re-applies the file-backed Account Default Profile.
  assert.match(source, /getAccountDefaultProfileForScopeInit/);
});

test('profile section restores account profile CRUD without turning profiles into capability categories', () => {
  const source = readFileSync(sourcePath, 'utf8');
  assert.match(source, /createAccountProfileLibraryEntry/);
  assert.match(source, /editAccountProfileLibraryEntry/);
  assert.match(source, /deleteAccountProfileLibraryEntry/);
  assert.match(source, /profileCapabilitiesFromAIConfig/);
  assert.match(source, /accountDefaultProfile \? \[accountDefaultProfile\] : \[\]/);
  assert.match(source, /onApply=\{\(profileId\) => profile\.onApply\(profileId\)\}/);
  assert.doesNotMatch(source, /createAccountProfileLibraryEntry[\s\S]{0,300}aiConfigService\.aiConfig\.update/);
  assert.doesNotMatch(source, /editAccountProfileLibraryEntry[\s\S]{0,300}aiConfigService\.aiConfig\.update/);
});

// ---------------------------------------------------------------------------
// T2.5 acceptance — profile apply preview + no silent AIConfig mutation
//
// Product manual "Profile And AIConfig Model":
//   - editing or replacing Account Default Profile never mutates existing AIConfig;
//   - applying a profile to existing scopes is explicit, previewed, and atomic.
// ---------------------------------------------------------------------------

const libraryPath = path.join(
  import.meta.dirname,
  '../src/shell/renderer/features/runtime-config/runtime-config-profile-library.ts',
);

test('factory-restore routes through the kit preview-gated controller, not a direct commit', () => {
  const source = readFileSync(sourcePath, 'utf8');
  // The explicit restore-to-Account-Default action re-applies through the kit
  // controller `onApply` — which is preview-gated (D-AIPC-014 / S-AICONF-008).
  // It must not issue an immediate-commit `aiProfile.apply` / `aiConfig.update`.
  assert.match(source, /profile\.onApply\(accountDefault\.profileId\)/);
  assert.match(source, /restorePreview/, 'restore must surface a "review then confirm" preview copy');
  assert.doesNotMatch(source, /aiConfigService\.aiProfile\.apply\(/);
  assert.doesNotMatch(source, /aiConfigService\.aiConfig\.update\(/);
});

test('account profile library layer never mutates scope-bound AIConfig', () => {
  // P-AIPS-013: the editable library is a file-family CRUD surface only.
  // Editing / importing / restoring library profiles must not write AIConfig.
  const source = readFileSync(libraryPath, 'utf8');
  assert.doesNotMatch(source, /aiConfig/i, 'profile library must not reference AIConfig');
  assert.doesNotMatch(source, /aiProfile\.apply/, 'profile library must not apply profiles');
  // The library only ever adopts a Rust-returned projection.
  assert.match(source, /adoptProjection/);
  assert.match(source, /single source of truth/);
});

test('profile library import/edit is library-scoped, decoupled from AIConfig apply', () => {
  // The Profiles section import handler writes the library file family
  // (importAccountProfileLibraryEntries) — a separate concern from apply.
  // Apply to a scope is a distinct, preview-gated kit-controller action.
  const source = readFileSync(sourcePath, 'utf8');
  assert.match(source, /importAccountProfileLibraryEntries/);
  assert.match(source, /useModelConfigProfileController/);
  // Import success copy must not claim a scope AIConfig was changed.
  assert.match(source, /importSuccess/);
  assert.doesNotMatch(source, /importAccountProfileLibraryEntries[\s\S]{0,200}aiProfile\.apply/);
});
