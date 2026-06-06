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
  ].map(read).join('\n');
}

function readTesterSettingsSurface(): string {
  const route = 'apps/tester/src/shell/routes/settings.tsx';
  const modulesRoot = path.join(repoRoot, 'apps/tester/src/shell/routes/settings');
  const modules = fs.readdirSync(modulesRoot, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.join('apps/tester/src/shell/routes/settings', entry.name))
    .filter((relativePath) => relativePath.endsWith('.ts') || relativePath.endsWith('.tsx'))
    .filter((relativePath) => relativePath !== route)
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
  assert.match(appRoutes, /from '@nimiplatform\/kit\/ui'/);
  assert.match(appRoutes, /from '@nimiplatform\/kit\/telemetry'/);
  for (const primitive of ['AmbientBackground', 'ProgressIndicator', 'Surface', 'logRendererEvent']) {
    assert.match(appRoutes, new RegExp(`\\b${primitive}\\b`));
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
  assert.match(profiles, /from '@nimiplatform\/kit\/features\/model-config'/);
  assert.match(profiles, /\bModelConfigAiModelHub\b/);
});

test('Tester is the second consumer for Kit shared primitives and shell bootstrap', () => {
  const main = read('apps/tester/src/main.tsx');
  assert.match(main, /from '@nimiplatform\/kit\/ui'/);
  assert.match(main, /\bNimiThemeProvider\b/);
  assert.match(main, /\bTooltipProvider\b/);
  assert.match(main, /from '@nimiplatform\/kit\/shell\/renderer\/bridge'/);
  assert.match(main, /\binstallNimiShellRuntimeBridge\b/);
  assert.match(main, /from '@nimiplatform\/kit\/shell\/renderer\/bootstrap'/);
  assert.match(main, /\bcreateRendererEntryModuleLoader\b/);

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
  assert.match(settings, /from '@nimiplatform\/kit\/features\/model-config\/headless'/);
  assert.match(settings, /from '@nimiplatform\/kit\/features\/chat\/headless'/);
  assert.match(settings, /from '@nimiplatform\/kit\/features\/commerce\/realm'/);
  assert.match(settings, /from '@nimiplatform\/kit\/features\/chat\/realm'/);
  assert.match(settings, /from '@nimiplatform\/kit\/ui'/);

  const realmKitProjections = read('apps/tester/src/shell/routes/settings/realm-kit-projections.ts');
  assert.doesNotMatch(realmKitProjections, /from '@nimiplatform\/sdk\/runtime'/);
  assert.match(realmKitProjections, /from '@nimiplatform\/kit\/features\/avatar\/headless'/);
  assert.match(realmKitProjections, /from '@nimiplatform\/kit\/features\/avatar\/vrm'/);
  assert.match(realmKitProjections, /from '@nimiplatform\/kit\/features\/avatar\/live2d'/);
  assert.match(realmKitProjections, /runtime_agent_voice_playback_decision_not_public_in_sdk_vnext/);
  assert.doesNotMatch(realmKitProjections, /\bresolveRuntimeAgentVoicePlaybackDecision\b/);
  assert.match(realmKitProjections, /\bresolveAgentVoicePlaybackCue\b/);
  assert.match(realmKitProjections, /\bresolveAvatarVrmFramingPolicy\b/);
  assert.match(realmKitProjections, /\bresolveAvatarLive2dFramingPolicy\b/);

  const testerContract = read('apps/tester/test/tester-contract.test.mjs');
  const testerSettingsSurfaceTest = read('apps/tester/test/tester-settings-surface.test.mjs');
  const scaffoldBoundary = read('apps/tester/test/scaffold-boundary.test.mjs');
  const testerRuntimeAccountAuth = read('apps/tester/src/shell/auth/runtime-account-auth.ts');
  const testerWorkbench = read('apps/tester/src/tester/tester-workbench.tsx');
  assert.match(testerContract, /tester kit gallery showcases real kit components/);
  assert.match(testerContract, /tester auth and runtime bootstrap consume Kit shell bridge primitives/);
  assert.match(testerSettingsSurfaceTest, /tester settings consumes Kit model picker binding projection/);

  assert.match(scaffoldBoundary, /createRuntimeAccountBrowserBroker/);
  assert.match(testerContract, /createRuntimeAccountBrowserBroker/);
  assert.match(testerRuntimeAccountAuth, /from '@nimiplatform\/kit\/auth'/);
  assert.doesNotMatch(testerRuntimeAccountAuth, /desktop-runtime-oauth-url|#\/login|desktop_callback/);

  assert.match(testerWorkbench, /emitRuntimeLog/);
  assert.match(testerWorkbench, /from '@nimiplatform\/kit\/telemetry'/);
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

  assert.match(settings, /useTypedProjection/);
  assert.match(settings, /from '@nimiplatform\/kit\/ui'/);
  assert.match(settings, /useTypedProjection\(resolveTesterLocalRuntimeFacadeProjection/);
  assert.match(settings, /useTypedProjection\(resolveTesterRealmDataSyncProjection/);
  assert.match(settings, /localRuntimeFacadeProjection\.data/);
  assert.match(settings, /realmDataSyncProjection\.data/);
  assert.doesNotMatch(settings, /setLocalRuntimeFacadeProjection|setRealmDataSyncProjection/);
  assert.doesNotMatch(settings, /type LocalRuntimeFacadeProjectionState|type RealmDataSyncProjectionState/);
  assert.match(testerSettingsContract, /useTypedProjection/);
});

test('Tester product-local persistence consumes Kit core storage helpers', () => {
  const testerPreferences = read('apps/tester/src/tester/tester-preferences.ts');
  const testerAiConfigStore = read('apps/tester/src/tester/tester-ai-config-store.ts');
  const testerContract = read('apps/tester/test/tester-contract.test.mjs');

  assert.match(testerPreferences, /from '@nimiplatform\/kit\/core\/storage-json'/);
  assert.match(testerPreferences, /readStorageJsonFrom/);
  assert.match(testerPreferences, /writeStorageJsonTo/);
  assert.match(testerPreferences, /removeStorageKeyFrom/);
  assert.doesNotMatch(testerPreferences, /JSON\.parse\(raw\)/);
  assert.doesNotMatch(testerPreferences, /JSON\.stringify\(normalized\)/);

  assert.match(testerAiConfigStore, /from '@nimiplatform\/kit\/core\/storage-json'/);
  assert.match(testerAiConfigStore, /createNimiAIConfigStore/);
  assert.match(testerAiConfigStore, /createNimiAISnapshotStore/);
  assert.doesNotMatch(testerAiConfigStore, /createScopedAIConfigStore/);
  assert.doesNotMatch(testerAiConfigStore, /createScopedAISnapshotStore/);
  assert.match(testerContract, /tester product-local persistence consumes Kit core storage helpers/);
});
