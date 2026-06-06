import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';

const appsPanelSource = readFileSync(
  resolve(import.meta.dirname, '../src/shell/renderer/features/apps/apps-panel.tsx'),
  'utf8',
);
const appsDetailSource = readFileSync(
  resolve(import.meta.dirname, '../src/shell/renderer/features/apps/apps-detail-view.tsx'),
  'utf8',
);
const appsAIProfileSource = readFileSync(
  resolve(import.meta.dirname, '../src/shell/renderer/features/apps/apps-ai-profile-section.tsx'),
  'utf8',
);
const appsControllerSource = readFileSync(
  resolve(import.meta.dirname, '../src/shell/renderer/features/apps/apps-panel-controller.ts'),
  'utf8',
);
const desktopAIConfigServiceSource = readFileSync(
  resolve(import.meta.dirname, '../src/shell/renderer/app-shell/providers/desktop-ai-config-service.ts'),
  'utf8',
);

test('Apps detail renders an app-scope AIProfile repair/apply surface', () => {
  assert.match(appsPanelSource, /AppsAIProfileSection/);
  assert.match(appsPanelSource, /actionErrorAppId === detailEntry\.app\.appId/);
  assert.match(appsDetailSource, /aiProfileSection/);
  assert.match(appsAIProfileSource, /scopeRef = useMemo\(\(\) => \(\{ kind: 'app' as const, ownerId: entry\.app\.appId \}\)/);
  assert.match(appsAIProfileSource, /appAIConfigRequirementDeclarations\(entry\.app\)\[0\]!/);
  assert.match(appsAIProfileSource, /entry\.app\.aiProfileSelectionRef/);
  assert.match(appsAIProfileSource, /entry\.app\.capabilitySet\.join/);
});

test('Apps AIProfile repair reuses Kit preview-confirm apply semantics', () => {
  assert.match(appsAIProfileSource, /useModelConfigProfileController/);
  assert.match(appsAIProfileSource, /ProfileConfigSection/);
  assert.match(appsAIProfileSource, /defaultModelConfigProfileCopy/);
  assert.match(appsAIProfileSource, /getAccountDefaultProfileForScopeInit/);
  assert.match(appsAIProfileSource, /getCachedAccountProfileLibraryProfiles/);
  assert.doesNotMatch(appsAIProfileSource, /aiConfig\.update\(/);
  assert.doesNotMatch(appsAIProfileSource, /aiProfile\.apply\(/);
  assert.doesNotMatch(appsAIProfileSource, /provider(Profile)?Id|modelId|baseUrl|apiKey/);
});

test('Desktop host AIProfile apply resolves user-selected Account Default and library profiles', () => {
  assert.match(desktopAIConfigServiceSource, /resolveDesktopAIProfile/);
  assert.match(desktopAIConfigServiceSource, /resolveAccountDefaultAIProfile/);
  assert.match(desktopAIConfigServiceSource, /resolveAccountLibraryAIProfile/);
  assert.match(desktopAIConfigServiceSource, /listAccountProfileLibrary/);
  assert.match(desktopAIConfigServiceSource, /const profile = await resolveDesktopAIProfile\(profileId\)/);
  assert.match(desktopAIConfigServiceSource, /return resolveDesktopAIProfile\(profileId\)/);
});

test('Apps controller keeps setup/open failures scoped to the app that produced them', () => {
  assert.match(appsControllerSource, /actionErrorAppId/);
  assert.match(appsControllerSource, /setActionErrorAppId\(appId\)/);
  assert.match(appsControllerSource, /setActionErrorAppId\(null\)/);
});
