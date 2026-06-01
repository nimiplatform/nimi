import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const repoRoot = path.resolve(import.meta.dirname, '../../..');
const desktopRendererRoot = path.join(repoRoot, 'apps/desktop/src/shell/renderer');
const kitRoot = path.join(repoRoot, 'kit');
const kitFeaturesRoot = path.join(repoRoot, 'kit/features');

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

function isTestSource(filePath: string): boolean {
  const normalized = path.relative(repoRoot, filePath).split(path.sep).join('/');
  return (
    /(?:^|\/)(?:test|tests|__tests__)\/.+\.(?:ts|tsx)$/.test(normalized)
    || /\.(?:test|spec)\.(?:ts|tsx)$/.test(normalized)
  );
}

function importSpecifiers(source: string): string[] {
  const specifiers: string[] = [];
  const importPattern = /(?:from\s+|import\s*\(\s*)['"]([^'"]+)['"]/g;
  let match: RegExpExecArray | null;
  while ((match = importPattern.exec(source)) !== null) {
    const specifier = match[1];
    if (specifier) {
      specifiers.push(specifier);
    }
  }
  return specifiers;
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

  const gallery = read('apps/tester/src/tester/kit-component-gallery.tsx');
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

  const settings = read('apps/tester/src/shell/routes/settings.tsx');
  assert.match(settings, /from '@nimiplatform\/kit\/features\/model-config\/headless'/);
  assert.match(settings, /from '@nimiplatform\/kit\/features\/chat\/headless'/);
  assert.match(settings, /from '@nimiplatform\/kit\/features\/commerce\/realm'/);
  assert.match(settings, /from '@nimiplatform\/kit\/features\/avatar\/runtime'/);
  assert.match(settings, /from '@nimiplatform\/kit\/features\/chat\/realm'/);
  assert.match(settings, /from '@nimiplatform\/kit\/ui'/);

  const testerContract = read('apps/tester/test/tester-contract.test.mjs');
  assert.match(testerContract, /tester kit gallery showcases real kit components/);
  assert.match(testerContract, /tester auth and runtime bootstrap consume Kit shell bridge primitives/);
  assert.match(testerContract, /tester settings consumes Kit model picker binding projection/);
});

test('Kit non-test code routes static SDK imports through the SDK contract boundary only', () => {
  const offenders = walkSourceFiles(kitRoot)
    .filter((filePath) => !isTestSource(filePath))
    .filter((filePath) => path.relative(repoRoot, filePath).split(path.sep).join('/') !== 'kit/core/src/sdk-contract.ts')
    .filter((filePath) => {
      const specifiers = importSpecifiers(fs.readFileSync(filePath, 'utf8'));
      return specifiers.some((specifier) => specifier === '@nimiplatform/sdk' || specifier.startsWith('@nimiplatform/sdk/'));
    })
    .map((filePath) => path.relative(repoRoot, filePath));

  assert.deepEqual(offenders, [], 'Kit SDK imports must stay centralized in kit/core/src/sdk-contract.ts');

  const sdkContract = read('kit/core/src/sdk-contract.ts');
  assert.match(sdkContract, /resolveRealmMediaUrl/);

  const realmHelpers = read('kit/features/chat/src/realm/helpers.ts');
  assert.match(realmHelpers, /from '@nimiplatform\/kit\/core\/sdk-contract'/);
  assert.doesNotMatch(realmHelpers, /from '@nimiplatform\/sdk\/realm'/);
});

test('Kit feature modules do not import app or Runtime private boundaries', () => {
  const offenders = walkSourceFiles(kitFeaturesRoot)
    .filter((filePath) => !isTestSource(filePath))
    .flatMap((filePath) => {
      const relativePath = path.relative(repoRoot, filePath);
      return importSpecifiers(fs.readFileSync(filePath, 'utf8'))
        .filter((specifier) => (
          specifier.startsWith('apps/')
          || specifier.startsWith('@renderer')
          || specifier.includes('runtime/internal')
          || specifier.includes('dataSync')
        ))
        .map((specifier) => `${relativePath}: ${specifier}`);
    });

  assert.deepEqual(offenders, [], 'Kit features must not import app aliases, app sources, dataSync, or Runtime internals');
});
