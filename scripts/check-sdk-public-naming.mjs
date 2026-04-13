#!/usr/bin/env node

import { existsSync, promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const sdkSrcRoot = path.join(repoRoot, 'sdk/src');
const realmFacadePath = path.join(sdkSrcRoot, 'realm/index.ts');

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx']);
const SKIP_DIRS = new Set(['generated', 'dist', 'node_modules']);

const LEGACY_PUBLIC_SYMBOLS = new Set([
  'Me2FaService',
  'Auth2faVerifyDto',
  'Me2faVerifyDto',
  'Me2faPrepareResponseDto',
  'SocialV1DefaultVisibilityService',
  'SocialFourDimensionalAttributesService',
]);

const REQUIRED_REALM_FACADE_SYMBOLS = [
  'Realm',
  'RealmModel',
  'RealmOperations',
  'RealmServiceArgs',
  'RealmServiceResult',
  'requestDataExport',
  'requestAccountDeletion',
];

const FORBIDDEN_REALM_FACADE_SYMBOLS = [
  'MeTwoFactorService',
  'AuthTwoFactorVerifyInput',
  'MeTwoFactorVerifyInput',
  'MeTwoFactorPrepareOutput',
  'SocialDefaultVisibilityService',
  'sendAgentChannelMessage',
  'listAgentCoreMemories',
  'listAgentDyadicMemories',
  'commitAgentMemories',
];

const BANNED_PUBLIC_NAME_PATTERNS = [
  /2fa/,
  /2Fa/,
  /2FA/,
  /V\d+.*Service$/,
  /FourDimensional.*Service$/,
];

function getLine(source, index) {
  return source.slice(0, index).split('\n').length;
}

function extractNamedExports(source) {
  const exports = [];
  const exportStars = [];

  const declarationPattern = /\bexport\s+(?:declare\s+)?(?:async\s+)?(?:function|class|interface|type|enum|const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)/g;
  let declarationMatch = declarationPattern.exec(source);
  while (declarationMatch) {
    exports.push({
      name: declarationMatch[1],
      line: getLine(source, declarationMatch.index),
    });
    declarationMatch = declarationPattern.exec(source);
  }

  const namedExportPattern = /\bexport\s+(?:type\s+)?\{([\s\S]*?)\}\s+from\b/g;
  let namedMatch = namedExportPattern.exec(source);
  while (namedMatch) {
    const block = namedMatch[1] || '';
    const blockStart = namedMatch.index;
    const specifiers = block
      .split(',')
      .map((specifier) => specifier.trim())
      .filter(Boolean);
    for (const specifier of specifiers) {
      const normalized = specifier.replace(/^type\s+/, '').trim();
      const specMatch = normalized.match(/^([A-Za-z_$][A-Za-z0-9_$]*)(?:\s+as\s+([A-Za-z_$][A-Za-z0-9_$]*))?$/);
      if (!specMatch) {
        continue;
      }
      const publicName = specMatch[2] || specMatch[1];
      const relativeIndex = block.indexOf(specifier);
      exports.push({
        name: publicName,
        line: getLine(source, blockStart + Math.max(0, relativeIndex)),
      });
    }
    namedMatch = namedExportPattern.exec(source);
  }

  const exportStarPattern = /\bexport\s+(?:type\s+)?\*\s+from\s+['"](.+?)['"]/g;
  let exportStarMatch = exportStarPattern.exec(source);
  while (exportStarMatch) {
    exportStars.push(exportStarMatch[1]);
    exportStarMatch = exportStarPattern.exec(source);
  }

  return { exports, exportStars };
}

function resolveRelativeExportTarget(fromFile, specifier) {
  if (!specifier.startsWith('.')) {
    return null;
  }

  const base = path.resolve(path.dirname(fromFile), specifier);
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    path.join(base, 'index.ts'),
    path.join(base, 'index.tsx'),
  ];

  for (const candidate of candidates) {
    if (
      SOURCE_EXTENSIONS.has(path.extname(candidate))
      && path.isAbsolute(candidate)
      && existsSync(candidate)
    ) {
      return candidate;
    }
  }

  return null;
}

async function collectFiles(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) {
      continue;
    }
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectFiles(fullPath));
      continue;
    }
    if (!entry.isFile()) {
      continue;
    }
    if (!SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
      continue;
    }
    files.push(fullPath);
  }
  return files;
}

async function main() {
  const violations = [];
  const files = await collectFiles(sdkSrcRoot);
  const exportInfoByFile = new Map();

  for (const file of files) {
    const source = await fs.readFile(file, 'utf8');
    const exportInfo = extractNamedExports(source);
    exportInfoByFile.set(file, exportInfo);

    for (const item of exportInfo.exports) {
      const relative = path.relative(repoRoot, file).replaceAll(path.sep, '/');
      if (LEGACY_PUBLIC_SYMBOLS.has(item.name)) {
        violations.push(`${relative}:${String(item.line)} exports legacy public symbol: ${item.name}`);
      }

      for (const pattern of BANNED_PUBLIC_NAME_PATTERNS) {
        if (pattern.test(item.name)) {
          violations.push(`${relative}:${String(item.line)} exports non-normalized symbol: ${item.name}`);
          break;
        }
      }
    }
  }

  const resolvedFacadeSymbols = new Set();
  const facadeVisitStack = new Set();

  function collectResolvedExports(file) {
    if (facadeVisitStack.has(file)) {
      return;
    }
    facadeVisitStack.add(file);

    const exportInfo = exportInfoByFile.get(file);
    if (!exportInfo) {
      facadeVisitStack.delete(file);
      return;
    }

    for (const item of exportInfo.exports) {
      resolvedFacadeSymbols.add(item.name);
    }

    for (const specifier of exportInfo.exportStars) {
      const target = resolveRelativeExportTarget(file, specifier);
      if (target && exportInfoByFile.has(target)) {
        collectResolvedExports(target);
      }
    }

    facadeVisitStack.delete(file);
  }

  collectResolvedExports(realmFacadePath);

  const facadeSymbols = resolvedFacadeSymbols;
  for (const symbol of REQUIRED_REALM_FACADE_SYMBOLS) {
    if (!facadeSymbols.has(symbol)) {
      const relative = path.relative(repoRoot, realmFacadePath).replaceAll(path.sep, '/');
      violations.push(`${relative} missing required normalized facade symbol: ${symbol}`);
    }
  }
  for (const symbol of FORBIDDEN_REALM_FACADE_SYMBOLS) {
    if (facadeSymbols.has(symbol)) {
      const relative = path.relative(repoRoot, realmFacadePath).replaceAll(path.sep, '/');
      violations.push(`${relative} exports removed facade symbol: ${symbol}`);
    }
  }

  if (violations.length > 0) {
    process.stderr.write('SDK public naming violations found:\n');
    for (const violation of violations) {
      process.stderr.write(`- ${violation}\n`);
    }
    process.exitCode = 1;
    return;
  }

  process.stdout.write('SDK public naming check passed\n');
}

main().catch((error) => {
  process.stderr.write(`check-sdk-public-naming failed: ${String(error)}\n`);
  process.exitCode = 1;
});
