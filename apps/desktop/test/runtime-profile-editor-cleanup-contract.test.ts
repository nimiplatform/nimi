import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const profileManagementSource = readFileSync(
  resolve(import.meta.dirname, '../src/shell/renderer/features/runtime-config/runtime-config-profile-management-sections.tsx'),
  'utf8',
);
const runtimeConfigEnLocale = readFileSync(
  resolve(import.meta.dirname, '../src/shell/renderer/locales/en/46-runtimeConfig.json'),
  'utf8',
);
const runtimeConfigZhLocale = readFileSync(
  resolve(import.meta.dirname, '../src/shell/renderer/locales/zh/46-runtimeConfig.json'),
  'utf8',
);

test('Create Profile editor removes explanatory chrome and keeps real editing controls', () => {
  assert.match(profileManagementSource, /id="runtime-profiles-editor-title"/);
  assert.match(profileManagementSource, /runtimeConfig\.profiles\.titleLabel/);
  assert.match(profileManagementSource, /runtimeConfig\.profiles\.descriptionLabel/);
  assert.match(profileManagementSource, /runtimeConfig\.profiles\.tagsLabel/);
  assert.match(profileManagementSource, /runtimeConfig\.profiles\.profileBodyLabel/);
  assert.match(profileManagementSource, /runtimeConfig\.profiles\.saveProfile/);

  assert.doesNotMatch(profileManagementSource, /runtimeConfig\.profiles\.editorEyebrow/);
  assert.doesNotMatch(profileManagementSource, /runtimeConfig\.profiles\.profileIdentityHint/);
  assert.doesNotMatch(profileManagementSource, /runtimeConfig\.profiles\.editorIdentityTitle/);
  assert.doesNotMatch(profileManagementSource, /runtimeConfig\.profiles\.editorIdentityHint/);
  assert.doesNotMatch(profileManagementSource, /runtimeConfig\.profiles\.profileBodyHint/);
  assert.doesNotMatch(profileManagementSource, /data-testid="runtime-profiles-editor-boundary-panel"/);
  assert.doesNotMatch(profileManagementSource, /runtimeConfig\.profiles\.profileEditorScopeBoundary/);
  assert.doesNotMatch(profileManagementSource, /runtimeConfig\.profiles\.editorBoundary/);
  assert.doesNotMatch(profileManagementSource, /runtimeConfig\.profiles\.editorReserved/);
  assert.doesNotMatch(profileManagementSource, /runtimeConfig\.profiles\.editorTagCount/);
  assert.doesNotMatch(profileManagementSource, /runtimeConfig\.profiles\.editorReadyToSave/);
  assert.doesNotMatch(profileManagementSource, /runtimeConfig\.profiles\.editorNeedsRequiredFields/);
  assert.doesNotMatch(profileManagementSource, /<footer\b/);
  assert.doesNotMatch(runtimeConfigEnLocale, /"profileIdentityHint"\s*:/);
  assert.doesNotMatch(runtimeConfigEnLocale, /"profileBodyHint"\s*:/);
  assert.doesNotMatch(runtimeConfigZhLocale, /"profileIdentityHint"\s*:/);
  assert.doesNotMatch(runtimeConfigZhLocale, /"profileBodyHint"\s*:/);
});
