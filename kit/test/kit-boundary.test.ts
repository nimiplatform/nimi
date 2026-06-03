import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'vitest';

const kitRoot = process.cwd();
const repoRoot = path.resolve(kitRoot, '..');
const kitFeaturesRoot = path.join(kitRoot, 'features');

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
