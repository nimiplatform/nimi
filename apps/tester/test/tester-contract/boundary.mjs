import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
  RUNTIME_EXECUTION_MODE_STREAM,
  RUNTIME_EXECUTION_MODE_SYNC,
  RUNTIME_ROUTE_POLICY_CLOUD,
  RUNTIME_ROUTE_POLICY_LOCAL,
  RUNTIME_SCENARIO_TYPE_TEXT_EMBED,
  RUNTIME_SCENARIO_TYPE_TEXT_GENERATE,
  RUNTIME_SCHEDULING_DENIED,
  cleanupBehaviorModules,
  createMemoryStorage,
  importBehaviorModule,
  listSourceFiles,
  read,
  readTesterAiTestingSurface,
  readTesterKitComponentGallerySurface,
  readTesterRuntimeInvokersSurface,
  root,
  runnableSchedulingResponse,
  textEmbedScenarioResponse,
  textGenerateScenarioResponse,
  textScenarioStream,
} from './helpers.mjs';

test.after(cleanupBehaviorModules);

test('tester workbench is app-owned and rejects Desktop private imports', () => {
  const sources = listSourceFiles(path.join(root, 'src')).map((filePath) => readFileSync(filePath, 'utf8')).join('\n');
  assert.match(sources, /TesterWorkbench/);
  assert.match(sources, /KitComponentGallery/);
  assert.match(sources, /typed unavailable/i);
  assert.doesNotMatch(sources, /from ['"]@renderer\//);
  assert.doesNotMatch(sources, /from ['"]@runtime\//);
  assert.doesNotMatch(sources, /getDesktopAIConfigService/);
  assert.doesNotMatch(sources, /runtime-config-profile-library/);
  assert.doesNotMatch(sources, /mock.*success/i);
  assert.doesNotMatch(sources, /pseudo/i);
});

test('tester auth and runtime bootstrap consume Kit shell bridge primitives', () => {
  const main = read('src/main.tsx');
  const runtimeAccountAuth = read('src/shell/auth/runtime-account-auth.ts');
  const runtimePlatform = read('src/shell/auth/runtime-platform.ts');

  assert.match(main, /installNimiShellRuntimeBridge/);
  assert.match(main, /from '@nimiplatform\/kit\/shell\/renderer\/bridge'/);
  assert.match(runtimePlatform, /createNimiRuntimeFullAppRegistration/);
  assert.match(runtimePlatform, /const runtimeDeveloperRegistrationRequested = true/);
  assert.match(runtimePlatform, /developerRegistration:\s*runtimeDeveloperRegistrationRequested/);
  assert.doesNotMatch(runtimePlatform, /import\.meta[^;\n]*env|env\.DEV|metadata:\s*[^,\n]*developerRegistration/);
  assert.match(runtimePlatform, /getRuntimeAccountCaller/);
  assert.doesNotMatch(runtimePlatform, /export const runtimeAccountCaller\s*=\s*createNimiLocalFirstPartyRuntimeAccountCaller/);
  assert.match(runtimePlatform, /const accountRuntime = new Runtime\(runtimeOptions\(\)\);\s*await accountRuntime\.ready\(\);\s*await registerDeveloperRegisteredRuntimeAccountCaller\(accountRuntime\);/s);
  assert.match(runtimePlatform, /createNimiRuntimeAppSessionMetadataProvider/);
  assert.match(runtimePlatform, /authMetadata:\s*createRuntimeAppSessionMetadataProvider\(accountRuntime,\s*accountCaller\)/);
  assert.doesNotMatch(runtimePlatform, /accountRuntime\.account\.getAccessToken|createRuntimeAccountAccessTokenCallOptions|runtime-account-access-token/);
  assert.match(runtimePlatform, /createRuntimeAccountRefreshCallOptions/);
  assert.match(runtimePlatform, /createScopedClientId\('runtime-account-refresh'\)/);
  assert.match(runtimePlatform, /const runtimeProtectedScopes = \['ai\.spend\.meter'\] as const/);
  assert.match(runtimePlatform, /capabilities:\s*\[\.\.\.runtimeProtectedScopes\]/);
  assert.match(runtimePlatform, /accountRuntime\.grants\.authorizeExternalPrincipal/);
  assert.match(runtimePlatform, /withNimiRuntimeIdempotencyMetadata/);
  assert.match(runtimePlatform, /createScopedClientId\(`runtime-protected-\$\{normalizedSubject\}`\)/);
  assert.match(runtimePlatform, /ExternalPrincipalType\.APP/);
  assert.match(runtimePlatform, /PolicyMode\.CUSTOM/);
  assert.match(runtimePlatform, /AuthorizationPreset\.UNSPECIFIED/);
  assert.match(runtimePlatform, /'x-nimi-access-token-id'/);
  assert.match(runtimePlatform, /'x-nimi-access-token-secret'/);
  assert.match(runtimePlatform, /\.\.\.appSessionMetadata,\s*\.\.\.protectedAccessMetadata/s);
  assert.doesNotMatch(runtimeAccountAuth, /getAccessToken|createRuntimeAccountAccessTokenCallOptions|refreshAccountSession|createRuntimeAccountRefreshCallOptions/);
  assert.match(runtimeAccountAuth, /createTauriOAuthBridge/);
  assert.match(runtimeAccountAuth, /createRuntimeAccountBrowserBroker/);
  assert.match(runtimePlatform, /createNimiDeveloperRegisteredRuntimeAccountCaller/);
  assert.match(runtimePlatform, /from '@nimiplatform\/sdk\/runtime'/);
  assert.match(runtimeAccountAuth, /from '@nimiplatform\/kit\/shell\/renderer\/bridge'/);
  assert.doesNotMatch(runtimeAccountAuth, /getPlatformClient\(/);
  assert.doesNotMatch(runtimeAccountAuth, /@renderer\/bridge|runtime-bridge/);
  assert.doesNotMatch(runtimeAccountAuth, /runtime\.account\.beginLogin\(/);
  assert.doesNotMatch(runtimeAccountAuth, /runtime\.account\.completeLogin\(/);
  assert.doesNotMatch(runtimeAccountAuth, /ACCOUNT_CALLER_MODE|deviceId:\s*['"`]local-first-party-device|mode:\s*1|appInstanceId:\s*`\$\{appId\}\.local-first-party`/);
});

test('Tester consumes SDK Runtime agent smoke verification surface as second app proof', () => {
  const helper = read('src/tester/tester-runtime-smoke-verification.ts');
  assert.match(helper, /createNimiRuntimeAgentSmokeVerificationSurface/);
  assert.match(helper, /NimiRuntimeAgentSmokeVerificationSurface/);
  assert.match(helper, /from '@nimiplatform\/sdk\/runtime'/);
  assert.match(helper, /getRuntimePlatformProjection/);
  assert.doesNotMatch(helper, /createRuntimeAgentSmokeVerificationSurface/);
  assert.doesNotMatch(helper, /createRuntimeProtectedScopeHelper/);
  assert.doesNotMatch(helper, /withScopes\(/);
});

test('tester runtime unavailable flow consumes Kit offline coordinator', () => {
  const authGate = read('src/shell/auth/auth-gate.tsx');
  const unavailablePage = read('src/shell/auth/runtime-unavailable-page.tsx');

  assert.match(authGate, /from '@nimiplatform\/kit\/core\/offline-coordinator'/);
  assert.match(authGate, /new OfflineCoordinator\(\)/);
  assert.match(authGate, /markRuntimeReachable\(false\)/);
  assert.match(authGate, /markRuntimeReachable\(true\)/);
  assert.match(unavailablePage, /Offline tier: \{offlineTier\}/);
});

test('tester kit gallery showcases real kit components for third-party apps', () => {
  const gallery = readTesterKitComponentGallerySurface(root);
  for (const required of [
    'Button',
    'IconButton',
    'AppCardSurface',
    'CompactAction',
    'IconToggleAction',
    'FieldTrigger',
    'ScrollShell',
    'TextField',
    'TextareaField',
    'SelectField',
    'Toggle',
    'Checkbox',
    'Slider',
    'SegmentedControl',
    'ProgressIndicator',
    'InlineAlert',
    'StatusBadge',
    'Surface',
    'EmptyState',
    'LoadingSkeleton',
    'NimiText',
    'DataTable',
    'DataList',
    'Pagination',
    'Breadcrumb',
    'Steps',
    'Statistic',
    'StatisticGroup',
  ]) {
    assert.match(gallery, new RegExp(`\\b${required}\\b`));
  }
  // Components are consumed from the kit design authority, not re-implemented.
  assert.match(gallery, /from '@nimiplatform\/kit\/ui'/);
});

test('tester UI Recipes is an industrial two-pane kit component workbench', () => {
  const gallery = readTesterKitComponentGallerySurface(root);
  // Ontology taxonomy: seven canonical categories.
  for (const category of ['Foundations', 'Actions', 'Inputs', 'Selection', 'Overlays', 'Layouts', 'Data & Status']) {
    assert.match(gallery, new RegExp(category));
  }
  // Foundations show real color tokens + NimiText roles.
  assert.match(gallery, /Semantic color tokens/);
  assert.match(gallery, /--nimi-action-primary-bg/);
  assert.match(gallery, /NimiText roles/);
  // Glass material tiers are demonstrated.
  for (const tier of ['glass-thin', 'glass-regular', 'glass-thick', 'glass-chrome']) {
    assert.match(gallery, new RegExp(tier));
  }
  // Ant Design reference coverage: enterprise data display and navigation
  // primitives are first-class Kit recipes, not app-local widgets.
  for (const recipe of [
    'Breadcrumb, Steps, Pagination',
    'Statistic summary',
    'DataList',
    'DataTable',
  ]) {
    assert.match(gallery, new RegExp(recipe));
  }
  // Two-pane structure: taxonomy library + recipe cards. Live/code/props/a11y/tokens
  // are per-recipe controls, not one page-level switch that cuts the whole list.
  assert.match(gallery, /kit-doc__library/);
  assert.match(gallery, /kit-doc__main/);
  assert.match(gallery, /kit-doc__canvas/);
  assert.match(gallery, /kit-card__tabs/);
  assert.match(gallery, /RecipeModeContent/);
  assert.match(gallery, /Import and usage/);
  assert.match(gallery, /Props contract/);
  assert.doesNotMatch(gallery, /options=\{lanes\}|onChange=\{\.\.\.\}|value=\{n\}|\{rows\}|<Button \/>|title message confirmLabel/);
  assert.doesNotMatch(gallery, /kit-doc__modebar|kit-doc__modetabs|kit-doc__import|kit-doc__inspector|kit-doc__evidence|Selected recipe|Coverage map/);
  // It is pure component documentation — no runtime work.
  assert.match(gallery, /component documentation/);
  // The scenario-first composer was replaced by a component-first doc.
  assert.doesNotMatch(gallery, /Surface Scenario Rail|surfaceScenarios|Recipe Composer/);
});

test('tester capability runs consume Kit renderer telemetry', () => {
  const workbench = read('src/tester/tester-workbench.tsx');
  const testerAiConfig = read('src/tester/tester-ai-config.ts');
  const testerRuntime = read('src/tester/tester-runtime.ts');

  assert.match(workbench, /from '@nimiplatform\/kit\/telemetry'/);
  assert.match(workbench, /from '@nimiplatform\/sdk'/);
  assert.match(workbench, /from '@nimiplatform\/sdk\/types'/);
  assert.match(workbench, /loadTesterAIConfigSummary/);
  assert.match(testerAiConfig, /inspectRuntimeReadiness/);
  assert.match(testerRuntime, /from '\.\.\/shell\/auth\/runtime-platform\.js'/);
  assert.doesNotMatch(workbench, /from '@nimiplatform\/sdk\/runtime'/);
  assert.match(workbench, /createNimiClientId\('run'\)/);
  assert.match(workbench, /requestWithRetry/);
  assert.match(workbench, /executor:\s*loadTesterRunHistory/);
  assert.match(workbench, /createRendererFlowId\('tester-capability-run'\)/);
  assert.match(workbench, /logRendererEvent\(/);
  assert.match(workbench, /emitRuntimeLog/);
  assert.match(workbench, /action:tester-capability-run:recorded/);
  assert.match(workbench, /history-load-failed/);
  assert.doesNotMatch(workbench, /runtime-bridge\/logging|@renderer\/.*telemetry/);
  assert.doesNotMatch(workbench, /Math\.random\(\)/);
});

test('tester product-local persistence consumes Kit core storage helpers', () => {
  const preferences = read('src/tester/tester-preferences.ts');
  const store = read('src/tester/tester-ai-config-store.ts');

  assert.match(preferences, /from '@nimiplatform\/kit\/core\/storage-json'/);
  for (const helper of [
    'resolveBrowserStorage',
    'readStorageJsonFrom',
    'writeStorageJsonTo',
    'removeStorageKeyFrom',
  ]) {
    assert.match(preferences, new RegExp(helper));
  }
  assert.match(store, /from '@nimiplatform\/kit\/core\/storage-json'/);
  assert.match(store, /resolveBrowserStorage\('local'\)/);
});

test('tester app-owned Tauri commands are registered in standalone shell', () => {
  const main = read('src-tauri/src/main.rs');
  assert.match(main, /tester_run_history_load/);
  assert.match(main, /tester_image_history_save/);
  assert.match(main, /tester_artifact_save/);
  assert.match(main, /tester_export_save/);
  assert.match(main, /open_world_tour_window/);
  assert.match(main, /claim_world_tour_viewer_launch/);
});

test('tester scaffold boundary expands beyond the product route', () => {
  const agents = read('AGENTS.md');
  assert.match(agents, /src\/shell\/routes\/product-area\.tsx/);
  assert.match(agents, /src\/tester\/\*\*/);
  assert.match(agents, /src-tauri\/src\/\{tester_storage\.rs,world_tour\.rs\}/);
  assert.match(agents, /tester contract tests/);
});
