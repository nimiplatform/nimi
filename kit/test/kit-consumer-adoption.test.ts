import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'vitest';

const kitRoot = process.cwd();
const repoRoot = path.resolve(kitRoot, '..');
const desktopRendererRoot = path.join(repoRoot, 'apps/desktop/src/shell/renderer');

function read(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function walkSourceFiles(root: string): string[] {
  const ignoredDirectories = new Set([
    'node_modules',
    'dist',
    'generated',
    'gen',
    '.cache',
  ]);

  return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      if (ignoredDirectories.has(entry.name)) {
        return [];
      }
      return walkSourceFiles(entryPath);
    }
    if (!/\.(?:ts|tsx)$/.test(entry.name) || /\.d\.ts$/.test(entry.name)) {
      return [];
    }
    return [entryPath];
  });
}

function readTesterKitGallerySurface(): string {
  return [
    'apps/tester/src/tester/kit-component-gallery.tsx',
    'apps/tester/src/tester/kit-component-gallery-surface.tsx',
    'apps/tester/src/tester/kit-component-gallery-recipes.tsx',
    'apps/tester/src/tester/kit-component-gallery-data-recipes.tsx',
    'apps/tester/src/tester/kit-component-gallery-demos.tsx',
  ].map(read).join('\n');
}

function readTesterSettingsSurface(): string {
  const route = 'apps/tester/src/shell/routes/settings-route.tsx';
  const modulesRoot = path.join(repoRoot, 'apps/tester/src/shell/routes/settings');
  const modules = walkSourceFiles(modulesRoot)
    .map((filePath) => path.relative(repoRoot, filePath))
    .sort();

  return [route, ...modules].map(read).join('\n');
}

test('Desktop consumes Kit shared UI, telemetry, and feature primitives for audited app surfaces', () => {
  const forbiddenComponentImports = walkSourceFiles(desktopRendererRoot).filter((filePath) => {
    const source = fs.readFileSync(filePath, 'utf8');
    return /@renderer\/components\/(?:action|surface|scroll-shell|design-tokens|sidebar|tooltip|overlay)/.test(source);
  });

  assert.deepEqual(
    forbiddenComponentImports.map((filePath) => path.relative(repoRoot, filePath)),
    [],
    'Desktop renderer must not resurrect local forwarding shells for Kit UI primitives',
  );

  for (const removed of [
    'apps/desktop/src/shell/renderer/components/action.tsx',
    'apps/desktop/src/shell/renderer/components/surface.tsx',
    'apps/desktop/src/shell/renderer/components/scroll-shell.tsx',
    'apps/desktop/src/shell/renderer/components/design-tokens.ts',
    'apps/desktop/src/shell/renderer/components/sidebar.tsx',
    'apps/desktop/src/shell/renderer/components/tooltip.tsx',
    'apps/desktop/src/shell/renderer/components/overlay/index.ts',
  ]) {
    assert.equal(fs.existsSync(path.join(repoRoot, removed)), false, `${removed} must stay owned by Kit`);
  }

  const sideSheet = read('apps/desktop/src/shell/renderer/features/chat/chat-shared-side-sheet.tsx');
  assert.match(sideSheet, /from '@nimiplatform\/kit\/ui'/);
  for (const primitive of ['AppCardSurface', 'IconToggleAction', 'ScrollShell']) {
    assert.match(sideSheet, new RegExp(`\\b${primitive}\\b`));
  }

  const profilePosts = read('apps/desktop/src/shell/renderer/features/profile/posts-tab.tsx');
  assert.match(profilePosts, /from '@nimiplatform\/kit\/ui'/);
  assert.match(profilePosts, /\bCompactAction\b/);

  const appRoutes = read('apps/desktop/src/shell/renderer/app-shell/routes/app-routes.tsx');
  const runtimeLoadingScreen = read('apps/desktop/src/shell/renderer/app-shell/routes/runtime-loading-screen.tsx');
  const appRouteSurfaces = `${appRoutes}\n${runtimeLoadingScreen}`;
  assert.match(appRoutes, /from '@nimiplatform\/kit\/ui'/);
  assert.match(appRoutes, /from '@nimiplatform\/kit\/telemetry'/);
  for (const primitive of ['AmbientBackground', 'ProgressIndicator', 'Surface', 'logRendererEvent']) {
    assert.match(appRouteSurfaces, new RegExp(`\\b${primitive}\\b`));
  }

  const runtimeInspect = read('apps/desktop/src/shell/renderer/features/chat/chat-runtime-inspect-content.tsx');
  assert.match(runtimeInspect, /from '@nimiplatform\/kit\/features\/chat\/components\/canonical-runtime-inspect-sidebar'/);
  assert.match(runtimeInspect, /\bCanonicalRuntimeInspectSidebar\b/);

  const catalog = read('apps/desktop/src/shell/renderer/features/runtime-config/runtime-config-page-catalog.tsx');
  assert.match(catalog, /from '@nimiplatform\/kit\/features\/model-picker\/ui'/);
  assert.match(catalog, /from '@nimiplatform\/kit\/features\/model-picker\/runtime'/);
  assert.match(catalog, /\bRuntimeModelPickerPanel\b/);
  assert.match(catalog, /\buseRuntimeModelPickerPanel\b/);

  const profiles = read('apps/desktop/src/shell/renderer/features/runtime-config/runtime-config-page-profiles.tsx');
  assert.doesNotMatch(profiles, /from '@nimiplatform\/kit\/features\/model-config'/);
  assert.doesNotMatch(profiles, /\bModelConfigAiModelHub\b/);
});

test('Tester is the second consumer for Kit shared primitives and shell bootstrap', () => {
  const main = read('apps/tester/src/main.tsx');
  const app = read('apps/tester/src/shell/App.tsx');
  const canonicalFactory = read('apps/tester/src/renderer/factory.tsx');
  assert.match(main, /from '@nimiplatform\/kit\/shell\/renderer\/host'/);
  assert.match(main, /\bcreateNimiRendererHostBinding\b/);
  assert.match(main, /from '@nimiplatform\/kit\/shell\/renderer\/bridge'/);
  assert.match(main, /\binstallNimiShellRuntimeBridge\b/);
  assert.match(main, /from '@nimiplatform\/kit\/shell\/renderer\/bootstrap'/);
  assert.match(main, /\bcreateRendererEntryModuleLoader\b/);
  assert.match(app, /\bNimiRendererHostProvider\b/);
  assert.match(app, /\btesterCanonicalRendererFactory\.createInstance\b/);
  assert.doesNotMatch(app, /useState\(\(\)\s*=>\s*testerCanonicalRendererFactory\.createInstance/);
  assert.match(app, /useEffect\(\(\)\s*=>\s*\{[\s\S]*testerCanonicalRendererFactory\.createInstance/);
  assert.match(app, /return \(\)\s*=>\s*\{ void instance\.dispose\(\); \}/);
  assert.match(canonicalFactory, /from '@nimiplatform\/kit\/ui'/);
  assert.match(canonicalFactory, /\bTooltipProvider\b/);

  const gallery = readTesterKitGallerySurface();
  assert.match(gallery, /from '@nimiplatform\/kit\/ui'/);
  for (const primitive of [
    'Button',
    'IconButton',
    'AppCardSurface',
    'CompactAction',
    'IconToggleAction',
    'ScrollShell',
    'Surface',
    'ProgressIndicator',
    'TooltipProvider',
    'OverlayShell',
  ]) {
    assert.match(gallery, new RegExp(`\\b${primitive}\\b`));
  }

  const settings = readTesterSettingsSurface();
  assert.match(settings, /from '@nimiplatform\/kit\/core\/notifications'/);
  assert.match(settings, /from '@nimiplatform\/kit\/features\/chat\/realm'/);
  assert.match(settings, /from '@nimiplatform\/kit\/ui'/);
  assert.doesNotMatch(settings, /not_public_in_sdk_vnext|data-settings-row-kind="proof"/);

  const testerContract = read('apps/tester/test/tester-contract.test.mjs');
  const testerSettingsSurfaceTest = read('apps/tester/test/tester-settings-surface.test.mjs');
  const scaffoldBoundary = read('apps/tester/test/scaffold-boundary.test.mjs');
  const testerRuntimePlatform = read('apps/tester/src/shell/auth/runtime-platform.ts');
  const testerLocalAppPlatform = read('apps/tester/src/shell/local-app-runtime-platform.ts');
  const testerWorkbench = read('apps/tester/src/tester/tester-workbench.tsx');
  const testerProductionBindings = read('apps/tester/src/renderer/production-bindings.ts');
  assert.match(testerContract, /tester kit gallery showcases real kit components/);
  assert.match(testerContract, /tester auth and runtime bootstrap consume Kit shell bridge primitives/);
  assert.match(testerSettingsSurfaceTest, /tester settings keeps real Realm live rows through SDK and Kit helpers/);

  assert.match(scaffoldBoundary, /runtime-platform\.ts/);
  assert.match(scaffoldBoundary, /local-app-runtime-platform\.ts/);
  assert.match(testerContract, /Runtime account projection without account control/);
  assert.match(testerRuntimePlatform, /testerLocalAppClient\.auth\.status\(\)/);
  assert.match(testerRuntimePlatform, /status\.sessionBound/);
  assert.doesNotMatch(testerRuntimePlatform, /operationAllowed/);
  assert.match(testerLocalAppPlatform, /createNimiClient/);
  assert.match(testerLocalAppPlatform, /createNimiLocalAppStandardShellSurface/);
  assert.doesNotMatch(testerLocalAppPlatform, /\.artifacts\b|readRuntimeBytes/);
  assert.doesNotMatch(testerRuntimePlatform, /testerInstalledAppBootstrap|bootstrapArtifactId/);
  assert.doesNotMatch(testerRuntimePlatform, /createRuntimeAccountBrowserBroker|createNimiRuntimeFullAppRegistration|getAccountSessionStatus|beginLogin|completeLogin|logout|switchAccount|refreshAccountSession|getAccessToken/);
  assert.doesNotMatch(testerRuntimePlatform, /desktop-runtime-oauth-url|#\/login|desktop_callback|runtimeEndpoint/);

  assert.match(testerWorkbench, /commands\.runtimeLog/);
  assert.match(testerProductionBindings, /emitRuntimeLog/);
  assert.match(testerProductionBindings, /from '@nimiplatform\/kit\/telemetry'/);
  assert.match(testerWorkbench, /area:\s*'tester-history'/);
  assert.match(testerWorkbench, /message:\s*'history-load-failed'/);
  assert.match(testerContract, /emitRuntimeLog/);
});

test('Support typed projection lifecycle is owned by Kit UI and consumed by apps', () => {
  assert.equal(
    fs.existsSync(path.join(repoRoot, 'apps/desktop/src/shell/renderer/features/support/support-projection.ts')),
    false,
    'Desktop must not keep an app-local Support typed projection hook',
  );

  for (const file of [
    'apps/desktop/src/shell/renderer/features/support/support-diagnostics-section.tsx',
    'apps/desktop/src/shell/renderer/features/support/support-logs-section.tsx',
    'apps/desktop/src/shell/renderer/features/support/support-repair-section.tsx',
    'apps/desktop/src/shell/renderer/features/support/support-recovery-section.tsx',
  ]) {
    const source = read(file);
    assert.match(source, /useTypedProjection as useSupportProjection/);
    assert.match(source, /from '@nimiplatform\/kit\/ui'/);
    assert.doesNotMatch(source, /support-projection/);
    assert.match(source, /SupportFailClosed/);
  }

  const settings = readTesterSettingsSurface();
  const testerSettingsContract = read('apps/tester/test/tester-settings-surface.test.mjs');

  assert.match(settings, /from '@nimiplatform\/kit\/ui'/);
  assert.match(settings, /from '@nimiplatform\/kit\/core\/notifications'/);
  assert.match(settings, /from '@nimiplatform\/kit\/features\/chat\/realm'/);
  assert.doesNotMatch(settings, /useTypedProjection/);
  assert.doesNotMatch(settings, /setLocalRuntimeFacadeProjection|setRealmDataSyncProjection/);
  assert.doesNotMatch(settings, /type LocalRuntimeFacadeProjectionState|type RealmDataSyncProjectionState/);
  assert.match(testerSettingsContract, /tester settings does not create local Runtime, Realm, admission, or permission truth/);
});

test('Tester keeps app-owned preferences in Kit storage while unadmitted platform storage fails closed', () => {
  const testerPreferences = read('apps/tester/src/tester/tester-preferences.ts');
  const testerAiConfigStore = read('apps/tester/src/tester/tester-ai-config-store.ts');
  const testerContract = read('apps/tester/test/tester-contract.test.mjs');

  assert.match(testerPreferences, /from '@nimiplatform\/kit\/core\/storage-json'/);
  assert.match(testerPreferences, /readStorageJsonFrom/);
  assert.match(testerPreferences, /writeStorageJsonTo/);
  assert.match(testerPreferences, /removeStorageKeyFrom/);
  assert.doesNotMatch(testerPreferences, /JSON\.parse\(raw\)/);
  assert.doesNotMatch(testerPreferences, /JSON\.stringify\(normalized\)/);

  assert.match(testerAiConfigStore, /createNimiError/);
  assert.match(testerAiConfigStore, /TESTER_LOCAL_APP_AI_CONFIG_UNAVAILABLE/);
  assert.match(testerAiConfigStore, /await_local_app_ai_config_operation_admission/);
  assert.doesNotMatch(testerAiConfigStore, /createInstalledNimiAppStandardShellSurface/);
  assert.doesNotMatch(testerAiConfigStore, /standardShellSurface\.aiConfig/);
  assert.doesNotMatch(testerAiConfigStore, /createNimiAISnapshotStore/);
  assert.doesNotMatch(testerAiConfigStore, /from '@nimiplatform\/kit\/core\/storage-json'/);
  assert.doesNotMatch(testerAiConfigStore, /resolveBrowserStorage/);
  assert.doesNotMatch(testerAiConfigStore, /createNimiAIConfigStore/);
  assert.doesNotMatch(testerAiConfigStore, /createScopedAIConfigStore/);
  assert.doesNotMatch(testerAiConfigStore, /createScopedAISnapshotStore/);
  assert.match(testerContract, /unadmitted AIConfig and standard storage fail closed with typed SDK errors/);
});

test('Tester Electron shell host uses the fixed app bridge without app-owned config custody', () => {
  const testerElectronMain = read('apps/tester/src-electron/main.ts');

  assert.match(
    testerElectronMain,
    /registerNimiElectronAppBridge/,
    'Tester Electron main must consume the fixed Kit app-host bridge',
  );
  assert.match(
    testerElectronMain,
    /from '@nimiplatform\/kit\/shell\/electron\/main'/,
    'Tester Electron main must import shell host AI config support from Kit',
  );
  assert.doesNotMatch(
    testerElectronMain,
    /createNimiElectronFileAIConfigStore|type NimiElectronAIConfigStore|testerAiConfigPath|isNotFoundError|commandHandlers|runtimeEndpoint/,
    'Tester Electron main must not keep duplicate config or Runtime authority',
  );
});
