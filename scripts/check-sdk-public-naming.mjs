#!/usr/bin/env node

import { promises as fs } from 'node:fs';
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
  'listAgentCoreMemories',
  'recallAgentMemoriesForEntity',
];

const FORBIDDEN_REALM_FACADE_SYMBOLS = [
  'MeTwoFactorService',
  'AuthTwoFactorVerifyInput',
  'MeTwoFactorVerifyInput',
  'MeTwoFactorPrepareOutput',
  'SocialDefaultVisibilityService',
  'sendAgentChannelMessage',
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

  return exports;
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
  const symbolMapByFile = new Map();

  for (const file of files) {
    const source = await fs.readFile(file, 'utf8');
    const exports = extractNamedExports(source);
    symbolMapByFile.set(file, new Set(exports.map((item) => item.name)));

    for (const item of exports) {
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

  const facadeSymbols = symbolMapByFile.get(realmFacadePath) || new Set();
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
