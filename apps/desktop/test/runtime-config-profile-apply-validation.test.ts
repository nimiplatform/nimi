import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const sourcePath = path.join(
  import.meta.dirname,
  '../src/shell/renderer/features/runtime-config/runtime-config-page-profiles.tsx',
);
const libraryPanelPath = path.join(
  import.meta.dirname,
  '../src/shell/renderer/features/runtime-config/runtime-config-profile-library-panel.tsx',
);
const managementSectionsPath = path.join(
  import.meta.dirname,
  '../src/shell/renderer/features/runtime-config/runtime-config-profile-management-sections.tsx',
);

// T2.4: Runtime > Profiles is an account AIProfile library surface. It must
// not mount a hidden current-scope AIConfig editor/apply flow.

test('profile section stays library-scoped and does not mount hidden AIConfig apply', () => {
  const source = readFileSync(sourcePath, 'utf8');
  assert.doesNotMatch(source, /ModelConfigAiModelHub/);
  assert.doesNotMatch(source, /useModelConfigProfileController/);
  assert.doesNotMatch(source, /useAppStore/);
  assert.doesNotMatch(source, /profileCapabilitiesFromAIConfig/);
  assert.doesNotMatch(source, /aiConfig\.capabilities/);
  assert.doesNotMatch(source, /aiConfigService\.aiProfile\.apply\(/);
  assert.doesNotMatch(source, /aiConfigService\.aiConfig\.update\(/);
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

test('profile section exposes file-backed library actions without factory restore apply', () => {
  const source = readFileSync(sourcePath, 'utf8');
  const libraryPanelSource = readFileSync(libraryPanelPath, 'utf8');
  const managementSectionsSource = readFileSync(managementSectionsPath, 'utf8');
  assert.match(libraryPanelSource, /runtime-profiles-account-library/);
  assert.match(libraryPanelSource, /runtime-profiles-create/);
  assert.match(managementSectionsSource, /runtime-profiles-import/);
  assert.match(managementSectionsSource, /runtime-profiles-export/);
  assert.match(source, /getAccountDefaultProfileForScopeInit/);
  assert.doesNotMatch(managementSectionsSource, /runtime-profiles-factory-restore/);
  assert.doesNotMatch(source, /profile\.onApply\(accountDefault\.profileId\)/);
});

test('profile section restores account profile CRUD and portable body editing', () => {
  const source = readFileSync(sourcePath, 'utf8');
  const libraryPanelSource = readFileSync(libraryPanelPath, 'utf8');
  const managementSectionsSource = readFileSync(managementSectionsPath, 'utf8');
  assert.match(source, /createAccountProfileLibraryEntry/);
  assert.match(source, /editAccountProfileLibraryEntry/);
  assert.match(source, /deleteAccountProfileLibraryEntry/);
  assert.match(source, /buildProfileFromEditorDraft/);
  assert.match(source, /PROFILE_BODY_RESERVED_FIELDS/);
  assert.match(source, /validateNimiAIProfile\(nextProfile\)/);
  assert.match(managementSectionsSource, /profileJsonText/);
  assert.match(managementSectionsSource, /profileBodyLabel/);
  assert.doesNotMatch(managementSectionsSource, /replaceWithCurrentConfig/);
  assert.doesNotMatch(managementSectionsSource, /current AI config/i);
  assert.doesNotMatch(libraryPanelSource, /onApply/);
  assert.doesNotMatch(libraryPanelSource, /onReplaceFromCurrent/);
  assert.doesNotMatch(source, /createAccountProfileLibraryEntry[\s\S]{0,300}aiConfigService\.aiConfig\.update/);
  assert.doesNotMatch(source, /editAccountProfileLibraryEntry[\s\S]{0,300}aiConfigService\.aiConfig\.update/);
});

// ---------------------------------------------------------------------------
// T2.5 acceptance — profile library CRUD + no silent AIConfig mutation
//
// Product manual "Profile And AIConfig Model":
//   - editing or replacing Account Default Profile never mutates existing AIConfig;
//   - applying a profile to existing scopes belongs to explicit app/module
//     scope surfaces, not Runtime > Profiles.
// ---------------------------------------------------------------------------

const libraryPath = path.join(
  import.meta.dirname,
  '../src/shell/renderer/features/runtime-config/runtime-config-profile-library.ts',
);

test('runtime profiles has no factory-restore apply path', () => {
  const source = readFileSync(sourcePath, 'utf8');
  const managementSectionsSource = readFileSync(managementSectionsPath, 'utf8');
  assert.doesNotMatch(source, /profile\.onApply\(accountDefault\.profileId\)/);
  assert.doesNotMatch(source, /restorePreview/);
  assert.doesNotMatch(managementSectionsSource, /factoryRestore/);
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

test('profile library import/edit is library-scoped and decoupled from AIConfig apply', () => {
  // The Profiles section import handler writes the library file family
  // (importAccountProfileLibraryEntries) — a separate concern from scope apply.
  const source = readFileSync(sourcePath, 'utf8');
  const managementSectionsSource = readFileSync(managementSectionsPath, 'utf8');
  assert.match(managementSectionsSource, /importAccountProfileLibraryEntries/);
  assert.doesNotMatch(source, /useModelConfigProfileController/);
  // Import success copy must not claim a scope AIConfig was changed.
  assert.match(managementSectionsSource, /importSuccess/);
  assert.doesNotMatch(managementSectionsSource, /importAccountProfileLibraryEntries[\s\S]{0,200}aiProfile\.apply/);
});
