import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'vitest';

const kitRoot = process.cwd();
const repoRoot = path.resolve(kitRoot, '..');
const kitFeaturesRoot = path.join(kitRoot, 'features');
const sdkContractPath = path.join(kitRoot, 'core/src/sdk-contract.ts');
const admittedSdkSpecifiers = new Set([
  '@nimiplatform/sdk',
  '@nimiplatform/sdk/ai',
  '@nimiplatform/sdk/app',
  '@nimiplatform/sdk/contracts',
  '@nimiplatform/sdk/features/conversation',
  '@nimiplatform/sdk/features/generation',
  '@nimiplatform/sdk/realm',
  '@nimiplatform/sdk/realm/generated',
  '@nimiplatform/sdk/runtime',
  '@nimiplatform/sdk/runtime/generated',
  '@nimiplatform/sdk/types',
]);

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

function isAllowedSdkImportSource(filePath: string): boolean {
  const normalized = path.relative(repoRoot, filePath).split(path.sep).join('/');
  return (
    normalized === 'kit/core/src/sdk-contract.ts'
    || normalized.startsWith('kit/shell/electron/src/main/')
  );
}

function importSpecifiers(source: string): string[] {
  return [
    ...source.matchAll(/(?:from\s+|import\s*\(\s*)['"]([^'"]+)['"]/g),
    ...source.matchAll(/\bimport\s+['"]([^'"]+)['"]/g),
    ...source.matchAll(/\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g),
  ].map((match) => match[1]).filter((specifier): specifier is string => Boolean(specifier));
}

function resolvesToSdkContract(filePath: string, specifier: string): boolean {
  if (!specifier.startsWith('.')) {
    return false;
  }
  const resolved = path.resolve(path.dirname(filePath), specifier);
  return [
    resolved,
    `${resolved}.ts`,
    `${resolved}.tsx`,
    path.join(resolved, 'index.ts'),
    path.join(resolved, 'index.tsx'),
  ].some((candidate) => path.normalize(candidate) === path.normalize(sdkContractPath));
}

test('Kit code and tests route static SDK imports through the SDK contract boundary only', () => {
  const offenders = walkSourceFiles(kitRoot).flatMap((filePath) => {
    const relativePath = path.relative(repoRoot, filePath);
    const specifiers = importSpecifiers(fs.readFileSync(filePath, 'utf8'));
    return specifiers.flatMap((specifier) => {
      const isSdkSpecifier = specifier === '@nimiplatform/sdk'
        || specifier.startsWith('@nimiplatform/sdk/');
      if (resolvesToSdkContract(filePath, specifier)) {
        return [`${relativePath}: relative import ${specifier}`];
      }
      if (!isSdkSpecifier) {
        return [];
      }
      if (!isAllowedSdkImportSource(filePath)) {
        return [`${relativePath}: direct import ${specifier}`];
      }
      if (!admittedSdkSpecifiers.has(specifier)) {
        return [`${relativePath}: unadmitted import ${specifier}`];
      }
      return [];
    });
  });

  assert.deepEqual(offenders, [], 'Kit SDK imports must stay centralized in kit/core/src/sdk-contract.ts');

  const sdkContract = read('kit/core/src/sdk-contract.ts');
  assert.match(sdkContract, /resolveNimiRealmMediaUrl/);

  const realmModulePaths = [
    'kit/features/chat/src/realm/attachments.ts',
    'kit/features/chat/src/realm/codec.ts',
    'kit/features/chat/src/realm/events.ts',
    'kit/features/chat/src/realm/messages.ts',
    'kit/features/chat/src/realm/service.ts',
    'kit/features/chat/src/realm/shared.ts',
    'kit/features/chat/src/realm/timeline.ts',
    'kit/features/chat/src/realm/types.ts',
  ];
  const realmModules = realmModulePaths.map(read).join('\n');
  assert.match(realmModules, /from '@nimiplatform\/kit\/core\/sdk-contract'/);
  assert.match(realmModules, /from '\.\/codec\.js'/);
  assert.doesNotMatch(realmModules, /from '@nimiplatform\/sdk\/realm'/);

  for (const relativePath of [
    'kit/features/chat/src/realm/attachments.ts',
    'kit/features/chat/src/realm/events.ts',
    'kit/features/chat/src/realm/messages.ts',
    'kit/features/chat/src/realm/shared.ts',
    'kit/features/chat/src/realm/timeline.ts',
  ]) {
    assert.doesNotMatch(read(relativePath), /from '\.\.\/headless\.js'/);
  }

  const chatHeadless = read('kit/features/chat/src/headless.ts');
  assert.doesNotMatch(chatHeadless, /realm\/codec/);
  assert.doesNotMatch(chatHeadless, /normalizeRealmMessagePayload/);

  const chatRealm = read('kit/features/chat/src/realm.ts');
  assert.match(chatRealm, /normalizeRealmMessagePayload/);
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
