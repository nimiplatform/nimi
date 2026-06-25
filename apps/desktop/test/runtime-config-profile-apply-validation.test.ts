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
const englishLocalePath = path.join(
  import.meta.dirname,
  '../src/shell/renderer/locales/en/46-runtimeConfig.json',
);
const chineseLocalePath = path.join(
  import.meta.dirname,
  '../src/shell/renderer/locales/zh/46-runtimeConfig.json',
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
  assert.match(source, /runtime-profiles-create/);
  assert.match(managementSectionsSource, /runtime-profiles-import/);
  assert.match(managementSectionsSource, /runtime-profiles-export/);
  assert.match(source, /getAccountDefaultProfileForScopeInit/);
  assert.doesNotMatch(managementSectionsSource, /runtime-profiles-factory-restore/);
  assert.doesNotMatch(source, /profile\.onApply\(accountDefault\.profileId\)/);
});

test('profile section repairs missing Account Default Profile through the product-control owner before reading it', () => {
  const source = readFileSync(sourcePath, 'utf8');
  const ensureIndex = source.indexOf('await ensureProductAccountDefaultProfile();');
  const libraryReadIndex = source.indexOf('loadAccountProfileLibrary()', ensureIndex);
  const defaultReadIndex = source.indexOf('getAccountDefaultProfileForScopeInit()', ensureIndex);
  assert.notEqual(ensureIndex, -1, 'Profiles refresh must call the Account Default Profile owner ensure path');
  assert.ok(
    libraryReadIndex > ensureIndex,
    'Profiles refresh must read the account library only after owner ensure has run',
  );
  assert.ok(
    defaultReadIndex > ensureIndex,
    'Profiles refresh must read Account Default Profile payload only after owner ensure has run',
  );
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

test('profile section follows the reference management-page layout without widening scope', () => {
  const source = readFileSync(sourcePath, 'utf8');
  const libraryPanelSource = readFileSync(libraryPanelPath, 'utf8');
  const managementSectionsSource = readFileSync(managementSectionsPath, 'utf8');
  assert.match(source, /runtime-profiles-header/);
  assert.match(source, /runtime-profiles-header-actions/);
  assert.match(source, /className="ml-auto flex shrink-0 flex-wrap items-center justify-end gap-2"/);
  assert.doesNotMatch(source, /runtimeConfig\.profiles\.description/);
  assert.doesNotMatch(source, /runtimeConfig\.profiles\.subtitle/);
  assert.doesNotMatch(source, /runtimeConfig\.profiles\.title/);
  assert.doesNotMatch(source, /runtimeConfig\.profiles\.intentEyebrow/);
  assert.doesNotMatch(libraryPanelSource, /runtime-profiles-metric-grid/);
  assert.doesNotMatch(libraryPanelSource, /runtime-profiles-safety-note/);
  assert.doesNotMatch(libraryPanelSource, /runtimeConfig\.profiles\.safetyTitle/);
  assert.doesNotMatch(libraryPanelSource, /runtimeConfig\.profiles\.safetyBody/);
  assert.match(libraryPanelSource, /runtime-profiles-tabs/);
  assert.match(libraryPanelSource, /runtime-profiles-filter-bar/);
  assert.match(libraryPanelSource, /runtime-profiles-search/);
  assert.match(libraryPanelSource, /runtime-profiles-source-filter/);
  assert.doesNotMatch(libraryPanelSource, /runtime-profiles-tag-filter/);
  assert.doesNotMatch(libraryPanelSource, /runtimeConfig\.profiles\.tableDescription/);
  assert.doesNotMatch(libraryPanelSource, /row\.description/);
  assert.doesNotMatch(libraryPanelSource, /row\.tags/);
  assert.doesNotMatch(libraryPanelSource, /runtime-profiles-favorites-toggle/);
  assert.doesNotMatch(libraryPanelSource, /runtime-profiles-view-toggle/);
  assert.match(libraryPanelSource, /runtime-profiles-table/);
  assert.match(libraryPanelSource, /runtime-profiles-template-row/);
  assert.doesNotMatch(libraryPanelSource, /runtime-profiles-use-guide/);
  assert.doesNotMatch(libraryPanelSource, /runtimeConfig\.profiles\.howTemplatesUsed/);
  assert.match(managementSectionsSource, /runtime-profiles-file-transfer/);
  assert.doesNotMatch(libraryPanelSource, /scope apply/i);
  assert.doesNotMatch(managementSectionsSource, /scope apply/i);
});

test('profile section copy exposes user decisions instead of internal placeholder labels', () => {
  const forbiddenPlaceholderCopy = /Intent Title|Intent Body|Intent Task|Library Status Title|Library Status Hint|Metric Custom|Metric Exportable|Metric Imported|Default Usage Title|Default Usage Hint|Eyebrow|profile slices|import from a file/;
  const forbiddenApplyPromise = /Apply a profile to configure all capabilities at once/i;
  const collectStrings = (value: unknown): string[] => {
    if (typeof value === 'string') return [value];
    if (Array.isArray(value)) return value.flatMap((item) => collectStrings(item));
    if (value && typeof value === 'object') {
      return Object.values(value).flatMap((item) => collectStrings(item));
    }
    return [];
  };
  const requiredKeys = [
    'tabTemplateLibrary',
    'tabImportExportHistory',
    'searchPlaceholder',
    'allSources',
    'tableTemplateName',
    'tableSource',
    'tableUpdated',
    'tableActions',
    'useAsBase',
    'libraryEyebrow',
    'libraryStatusTitle',
    'libraryStatusHint',
    'metricCustom',
    'metricCustomHint',
    'metricExportable',
    'metricExportableHint',
    'metricImported',
    'metricImportedHint',
    'defaultUsageTitle',
    'defaultUsageHint',
    'createFromDefault',
    'createFromDefaultHint',
    'emptyCustomTitle',
    'loadingShort',
  ];
  for (const localePath of [englishLocalePath, chineseLocalePath]) {
    const locale = JSON.parse(readFileSync(localePath, 'utf8')) as { profiles: Record<string, unknown> };
    const { profiles } = locale;
    const expectedCreateLabel = localePath === englishLocalePath ? 'New Profile' : '新建 Profile';
    assert.equal(profiles.create, expectedCreateLabel, `${localePath} profiles.create must label the primary action as a profile`);
    for (const key of requiredKeys) {
      assert.equal(typeof profiles[key], 'string', `${localePath} must define profiles.${key}`);
      assert.notEqual(String(profiles[key]).trim(), '', `${localePath} profiles.${key} must not be empty`);
    }
    assert.match(String(profiles.useAsBase), /^\S+$/, `${localePath} profiles.useAsBase must fit a compact action button`);
    assert.equal(typeof profiles.origin, 'object', `${localePath} must define profile origin labels`);
    const copy = collectStrings(profiles).join('\n');
    assert.doesNotMatch(copy, forbiddenPlaceholderCopy, `${localePath} must not expose placeholder UI copy`);
    assert.doesNotMatch(copy, forbiddenApplyPromise, `${localePath} must not promise hidden AIConfig apply`);
  }
});

test('account default profile can be copied into an editable library draft', () => {
  const source = readFileSync(sourcePath, 'utf8');
  const libraryPanelSource = readFileSync(libraryPanelPath, 'utf8');
  assert.match(source, /openCreateProfileFromDefault/);
  assert.match(source, /accountDefaultProfile/);
  assert.match(source, /createEmptyLibraryProfile\(\)\.profileId/);
  assert.match(libraryPanelSource, /runtime-profiles-copy-default/);
  assert.match(libraryPanelSource, /onCreateFromDefault/);
  assert.doesNotMatch(source, /editAccountProfileLibraryEntry\(accountDefaultProfile/);
  assert.doesNotMatch(source, /deleteAccountProfileLibraryEntry\(accountDefaultProfile/);
});

test('profile editor opens as a full-page library composition layer', () => {
  const managementSectionsSource = readFileSync(managementSectionsPath, 'utf8');
  assert.match(managementSectionsSource, /import \{ createPortal \} from 'react-dom';/);
  assert.match(managementSectionsSource, /runtime-profiles-editor-full-page/);
  assert.match(managementSectionsSource, /runtime-profiles-editor-identity-panel/);
  assert.match(managementSectionsSource, /runtime-profiles-editor-json-panel/);
  assert.doesNotMatch(managementSectionsSource, /runtime-profiles-editor-boundary-panel/);
  assert.doesNotMatch(managementSectionsSource, /profileEditorScopeBoundary/);
  assert.match(managementSectionsSource, /createPortal\(editorLayer, document\.body\)/);
  assert.match(managementSectionsSource, /z-\[var\(--nimi-z-dialog\)\]/);
  assert.match(managementSectionsSource, /typeof document === 'undefined'/);
  assert.match(managementSectionsSource, /max-w-5xl/);
  assert.match(managementSectionsSource, /xl:grid-cols-\[minmax\(220px,0\.75fr\)_minmax\(420px,1\.35fr\)\]/);
  assert.doesNotMatch(managementSectionsSource, /max-w-2xl/);
  assert.doesNotMatch(managementSectionsSource, /max-w-6xl/);
  assert.doesNotMatch(managementSectionsSource, /xl:grid-cols-\[minmax\(220px,0\.75fr\)_minmax\(360px,1\.2fr\)_minmax\(220px,0\.7fr\)\]/);
  assert.doesNotMatch(managementSectionsSource, /lg:grid-cols-\[minmax\(260px,0\.8fr\)_minmax\(420px,1\.35fr\)_minmax\(260px,0\.75fr\)\]/);
  assert.doesNotMatch(managementSectionsSource, /z-50/);
});

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
