import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const repoRoot = path.resolve(import.meta.dirname, '../../..');
const webRoot = path.join(repoRoot, 'apps/web');
const desktopPublicRoot = path.join(repoRoot, 'apps/desktop/src/public-web');
const webSrcRoot = path.join(webRoot, 'src');

const admittedPublicWebFiles = new Set([
  'app/index.ts',
  'app-store/index.ts',
  'bridge.ts',
  'i18n/index.ts',
  'infra/index.ts',
  'realm/index.ts',
  'styles.css',
]);

function walkFiles(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(root, entry.name);
    if (entry.isDirectory()) {
      return walkFiles(absolute);
    }
    return [absolute];
  });
}

function importSpecifiers(source: string): string[] {
  const specifiers: string[] = [];
  const importPattern = /(?:from\s+|import\s*\(\s*)['"]([^'"]+)['"]/g;
  let match: RegExpExecArray | null;
  while ((match = importPattern.exec(source)) !== null) {
    specifiers.push(match[1] || '');
  }
  return specifiers.filter(Boolean);
}

test('desktop public-web facade is the admitted web shell boundary', () => {
  const actual = walkFiles(desktopPublicRoot)
    .filter((absolute) => statSync(absolute).isFile())
    .map((absolute) => path.relative(desktopPublicRoot, absolute).split(path.sep).join('/'))
    .sort();

  assert.deepEqual(actual, [...admittedPublicWebFiles].sort());

  for (const relativePath of actual) {
    const source = readFileSync(path.join(desktopPublicRoot, relativePath), 'utf8');
    assert.match(source, /Desktop public-for-web boundary/);
    assert.doesNotMatch(source, /runtime\/internal|runtime\/cmd|src-tauri|@runtime\//);
  }

  const appStoreSource = readFileSync(path.join(desktopPublicRoot, 'app-store/index.ts'), 'utf8');
  const appStoreFacadeType = appStoreSource.match(
    /export type DesktopPublicWebBootstrapStore = \{[\s\S]*?\};/,
  )?.[0] || '';
  assert.match(appStoreSource, /desktopPublicWebBootstrapStore/);
  assert.match(appStoreFacadeType, /beginBootstrap/);
  assert.match(appStoreFacadeType, /applyAuthSession/);
  assert.match(appStoreFacadeType, /applyRuntimeDefaults/);
  assert.match(appStoreFacadeType, /completeBootstrap/);
  assert.match(appStoreFacadeType, /failBootstrap/);
  assert.doesNotMatch(appStoreFacadeType, /\btoken\b|\baccessToken\b|\brefreshToken\b/);
  assert.doesNotMatch(
    appStoreFacadeType,
    /\bsetAuthBootstrapping\b|\bsetAuthSession\b|\bclearAuthSession\b|\bsetRuntimeDefaults\b|\bsetBootstrapReady\b|\bsetBootstrapError\b/,
  );
  assert.doesNotMatch(appStoreSource, /token:\s*string/);
  assert.doesNotMatch(appStoreSource, /export\s+\{\s*useAppStore\s*\}/);
  assert.doesNotMatch(appStoreSource, /export\s+const\s+useAppStore/);
  assert.doesNotMatch(appStoreSource, /desktopPublicWebAppStore/);
});

test('web source imports desktop renderer only through public-web or admitted adapters', () => {
  const offenders: string[] = [];
  for (const absolute of walkFiles(webSrcRoot)) {
    if (!/\.(?:ts|tsx)$/.test(absolute)) {
      continue;
    }
    const relativePath = path.relative(webRoot, absolute).split(path.sep).join('/');
    const isAdmittedDesktopAdapter = relativePath.startsWith('src/desktop-adapter/');
    const specifiers = importSpecifiers(readFileSync(absolute, 'utf8'));
    for (const specifier of specifiers) {
      const isDesktopPrivate = specifier.startsWith('@renderer/') || specifier.startsWith('@runtime/');
      if (isDesktopPrivate && !isAdmittedDesktopAdapter) {
        offenders.push(`${relativePath}: ${specifier}`);
      }
      assert.ok(
        !specifier.includes('../desktop/src/'),
        `${relativePath} must not import Desktop source by relative path: ${specifier}`,
      );
    }
  }

  assert.deepEqual(offenders, []);
});

test('web documents and config keep the public-web contract explicit', () => {
  const agents = readFileSync(path.join(webRoot, 'AGENTS.md'), 'utf8');
  const readme = readFileSync(path.join(webRoot, 'README.md'), 'utf8');
  const viteConfig = readFileSync(path.join(webRoot, 'vite.config.ts'), 'utf8');
  const runtimeBootstrap = readFileSync(
    path.join(webRoot, 'src/desktop-adapter/runtime-bootstrap.web.ts'),
    'utf8',
  );

  assert.match(agents, /@desktop-public\/\*/);
  assert.match(readme, /Desktop public-for-web boundary/);
  assert.match(viteConfig, /find: '@desktop-public'/);
  assert.match(viteConfig, /@nimiplatform\\\/kit\\\/telemetry/);
  assert.match(viteConfig, /kit\/telemetry\/src\/telemetry\/index\.ts/);
  const runtimeWireTypesAliasIndex = viteConfig.indexOf("find: '@nimiplatform/sdk/runtime/wire-types'");
  const runtimeAliasIndex = viteConfig.indexOf("find: '@nimiplatform/sdk/runtime',");
  assert.notEqual(runtimeWireTypesAliasIndex, -1);
  assert.ok(runtimeWireTypesAliasIndex < runtimeAliasIndex);
  assert.match(viteConfig, /runtime\/wire-types\/index\.js/);
  assert.ok(existsSync(path.join(desktopPublicRoot, 'realm/index.ts')));
  assert.doesNotMatch(runtimeBootstrap, /type AuthSessionSnapshot/);
  assert.doesNotMatch(runtimeBootstrap, /getAuthSnapshot\(\).*token/s);
  assert.doesNotMatch(runtimeBootstrap, /applyAuthSession\([^)]*,\s*[^)]*\)/);
});
