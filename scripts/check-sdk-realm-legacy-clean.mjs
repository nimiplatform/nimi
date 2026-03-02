#!/usr/bin/env node

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');

const LEGACY_SERVICE_NAMES = new Set([
  'Me2FaService',
  'SocialV1DefaultVisibilityService',
  'SocialFourDimensionalAttributesService',
]);

const LEGACY_MODEL_SYMBOLS = new Set([
  'Auth2faVerifyDto',
  'Me2faVerifyDto',
  'Me2faPrepareResponseDto',
]);

const LEGACY_METHOD_NAMES = new Set([
  'verify2Fa',
  'disable2Fa',
  'enable2Fa',
  'prepare2Fa',
]);

const LEGACY_ENUM_KEYS = new Set([
  'NEEDS_2FA',
]);

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

async function main() {
  const violations = [];
  const realmIndexPath = path.join(repoRoot, 'sdk', 'src', 'realm', 'index.ts');
  const clientTypesPath = path.join(repoRoot, 'sdk', 'src', 'realm', 'client-types.ts');
  const operationMapPath = path.join(repoRoot, 'sdk', 'src', 'realm', 'generated', 'operation-map.ts');
  const propertyEnumsPath = path.join(repoRoot, 'sdk', 'src', 'realm', 'generated', 'property-enums.ts');
  const generatedModelsDir = path.join(repoRoot, 'sdk', 'src', 'realm', 'generated', 'models');

  const realmIndexSource = await fs.readFile(realmIndexPath, 'utf8');
  const exportedSymbols = extractNamedExports(realmIndexSource);
  for (const item of exportedSymbols) {
    if (LEGACY_SERVICE_NAMES.has(item.name) || LEGACY_MODEL_SYMBOLS.has(item.name)) {
      violations.push(`sdk/src/realm/index.ts:${item.line} exports legacy symbol: ${item.name}`);
    }
  }

  const clientTypesSource = await fs.readFile(clientTypesPath, 'utf8');
  for (const symbol of [...LEGACY_SERVICE_NAMES, ...LEGACY_MODEL_SYMBOLS]) {
    if (clientTypesSource.includes(symbol)) {
      violations.push(`sdk/src/realm/client-types.ts contains legacy symbol reference: ${symbol}`);
    }
  }

  const operationMapSource = await fs.readFile(operationMapPath, 'utf8');
  const fieldPatterns = [
    { label: 'service', pattern: /"service":\s*"([^"]+)"/g, legacySet: LEGACY_SERVICE_NAMES },
    { label: 'methodName', pattern: /"methodName":\s*"([^"]+)"/g, legacySet: LEGACY_METHOD_NAMES },
    { label: 'operationId', pattern: /"operationId":\s*"([^"]+)"/g, legacySet: LEGACY_METHOD_NAMES },
  ];
  for (const { label, pattern, legacySet } of fieldPatterns) {
    let match = pattern.exec(operationMapSource);
    while (match) {
      const value = match[1];
      if (legacySet.has(value)) {
        const line = getLine(operationMapSource, match.index);
        violations.push(`sdk/src/realm/generated/operation-map.ts:${line} legacy ${label}: ${value}`);
      }
      match = pattern.exec(operationMapSource);
    }
  }

  const propertyEnumsSource = await fs.readFile(propertyEnumsPath, 'utf8');
  const enumKeyPattern = /^\s*([A-Z][A-Z0-9_]*)\s*:/gm;
  let enumKeyMatch = enumKeyPattern.exec(propertyEnumsSource);
  while (enumKeyMatch) {
    const enumKey = enumKeyMatch[1];
    if (LEGACY_ENUM_KEYS.has(enumKey)) {
      const line = getLine(propertyEnumsSource, enumKeyMatch.index);
      violations.push(`sdk/src/realm/generated/property-enums.ts:${line} legacy enum key: ${enumKey}`);
    }
    enumKeyMatch = enumKeyPattern.exec(propertyEnumsSource);
  }

  const modelFiles = await fs.readdir(generatedModelsDir);
  for (const fileName of modelFiles) {
    const symbol = fileName.replace(/\.ts$/, '');
    if (LEGACY_MODEL_SYMBOLS.has(symbol)) {
      violations.push(`sdk/src/realm/generated/models/${fileName} uses legacy symbol name`);
    }
  }

  if (violations.length > 0) {
    process.stderr.write('SDK realm legacy symbol clean check failed:\n');
    for (const violation of violations) {
      process.stderr.write(`- ${violation}\n`);
    }
    process.exitCode = 1;
    return;
  }

  process.stdout.write('SDK realm legacy symbol clean check passed\n');
}

main().catch((error) => {
  process.stderr.write(`check-sdk-realm-legacy-clean failed: ${String(error)}\n`);
  process.exitCode = 1;
});

