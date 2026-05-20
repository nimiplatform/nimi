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
  assert.match(source, /runtime-profiles-import/);
  assert.match(source, /runtime-profiles-export/);
  assert.match(source, /runtime-profiles-factory-restore/);
  // Factory-restore re-applies the file-backed Account Default Profile.
  assert.match(source, /getAccountDefaultProfileForScopeInit/);
});
