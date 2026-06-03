#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const kitRoot = path.join(repoRoot, 'kit');
const featuresRoot = path.join(kitRoot, 'features');
const sdkContractPath = path.join(kitRoot, 'core', 'src', 'sdk-contract.ts');
const sdkContractSpecifier = '@nimiplatform/kit/core/sdk-contract';
const ignoredDirectories = new Set(['.cache', 'dist', 'gen', 'generated', 'node_modules']);
const checkedExtensions = new Set(['.ts', '.tsx']);
const violations = [];

function rel(absPath) {
  return path.relative(repoRoot, absPath).split(path.sep).join('/');
}

function walkFiles(root, files = []) {
  if (!fs.existsSync(root)) return files;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const absPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      if (ignoredDirectories.has(entry.name)) continue;
      walkFiles(absPath, files);
      continue;
    }
    if (!entry.isFile()) continue;
    if (entry.name.endsWith('.d.ts')) continue;
    if (!checkedExtensions.has(path.extname(entry.name))) continue;
    files.push(absPath);
  }
  return files;
}

function normalizeExportName(rawName) {
  const withoutType = rawName.replace(/^type\s+/u, '').trim();
  if (!withoutType) return '';
  const aliasMatch = withoutType.match(/^([A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)$/u);
  return aliasMatch ? aliasMatch[2] : withoutType;
}

function parseNamedList(rawList) {
  return rawList
    .split(',')
    .map((item) => normalizeExportName(item.trim()))
    .filter(Boolean);
}

function normalizeImportedContractName(rawName) {
  const withoutType = rawName.replace(/^type\s+/u, '').trim();
  if (!withoutType) return '';
  const aliasMatch = withoutType.match(/^([A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)$/u);
  return aliasMatch ? aliasMatch[1] : withoutType;
}

function parseNamedImportList(rawList) {
  return rawList
    .split(',')
    .map((item) => normalizeImportedContractName(item.trim()))
    .filter(Boolean);
}

function classifySdkOrigin(specifier) {
  if (specifier === '@nimiplatform/sdk/runtime' || specifier === '@nimiplatform/sdk/ai-app') {
    return 'runtime';
  }
  if (specifier === '@nimiplatform/sdk/realm') {
    return 'realm';
  }
  if (specifier === '@nimiplatform/sdk') {
    return 'platform-client';
  }
  if (specifier === '@nimiplatform/sdk/ai') {
    return 'ai-config';
  }
  if (specifier === '@nimiplatform/sdk/types') {
    return 'error';
  }
  return 'unknown';
}

function parseSdkContractExportOrigins() {
  const source = fs.readFileSync(sdkContractPath, 'utf8');
  const origins = new Map();
  const exportPattern = /export\s+(?:type\s+)?\{([^}]*)\}\s+from\s+['"]([^'"]+)['"]\s*;/gu;
  for (const match of source.matchAll(exportPattern)) {
    const names = parseNamedList(match[1] || '');
    const origin = classifySdkOrigin(String(match[2] || ''));
    for (const name of names) {
      origins.set(name, origin);
    }
  }
  return origins;
}

function surfaceKind(fileRel) {
  if (/^kit\/features\/[^/]+\/src\/runtime(?:\/|\.tsx?$)/u.test(fileRel)) {
    return 'runtime';
  }
  if (/^kit\/features\/[^/]+\/src\/realm(?:\/|\.tsx?$)/u.test(fileRel)) {
    return 'realm';
  }
  return null;
}

function escapeRegExp(input) {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function collectSdkContractNamedUsages(source) {
  const usages = [];
  const escapedSpecifier = escapeRegExp(sdkContractSpecifier);
  const namedFromPattern = new RegExp(
    String.raw`\b(?:import|export)\s+(?:type\s+)?\{([^}]*)\}\s+from\s+['"]${escapedSpecifier}['"]\s*;`,
    'gu',
  );
  for (const match of source.matchAll(namedFromPattern)) {
    usages.push(...parseNamedImportList(match[1] || ''));
  }

  const namespacePattern = new RegExp(
    String.raw`\bimport\s+\*\s+as\s+([A-Za-z_$][\w$]*)\s+from\s+['"]${escapedSpecifier}['"]`,
    'gu',
  );
  for (const match of source.matchAll(namespacePattern)) {
    usages.push(`* as ${String(match[1] || '')}`);
  }

  const dynamicAliasPattern = new RegExp(
    String.raw`\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:await\s*)?import\s*\(\s*['"]${escapedSpecifier}['"]\s*\)`,
    'gu',
  );
  for (const match of source.matchAll(dynamicAliasPattern)) {
    const alias = String(match[1] || '');
    const aliasMemberPattern = new RegExp(String.raw`\b${escapeRegExp(alias)}\.([A-Za-z_$][\w$]*)`, 'gu');
    for (const memberMatch of source.matchAll(aliasMemberPattern)) {
      usages.push(String(memberMatch[1] || ''));
    }
  }

  const dynamicThenPattern = new RegExp(
    String.raw`import\s*\(\s*['"]${escapedSpecifier}['"]\s*\)\s*\.\s*then\s*\(\s*(?:\(\s*)?([A-Za-z_$][\w$]*)(?:\s*\))?\s*=>`,
    'gu',
  );
  for (const match of source.matchAll(dynamicThenPattern)) {
    const alias = String(match[1] || '');
    const aliasMemberPattern = new RegExp(String.raw`\b${escapeRegExp(alias)}\.([A-Za-z_$][\w$]*)`, 'gu');
    for (const memberMatch of source.matchAll(aliasMemberPattern)) {
      usages.push(String(memberMatch[1] || ''));
    }
  }

  return usages;
}

function collectPlatformClientAliases(source) {
  const aliases = new Set();
  const aliasPattern = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*[\s\S]*?getPlatformClient\s*\([^)]*\)[\s\S]*?(?:;|\n)/gu;
  for (const match of source.matchAll(aliasPattern)) {
    aliases.add(String(match[1] || ''));
  }
  return [...aliases].filter(Boolean);
}

function collectPlatformClientMemberBindings(source) {
  const bindings = [];
  const directPattern = /getPlatformClient\s*\([^)]*\)\s*(?:\.\s*(realm|runtime)\b|\[\s*['"](realm|runtime)['"]\s*\]|\.\s*domains\s*\.\s*([A-Za-z_$][\w$]*))/gu;
  for (const match of source.matchAll(directPattern)) {
    bindings.push(match[1] || match[2] || match[3]);
  }

  for (const alias of collectPlatformClientAliases(source)) {
    const escapedAlias = escapeRegExp(alias);
    const aliasPattern = new RegExp(
      String.raw`\b${escapedAlias}\s*(?:\.\s*(realm|runtime)\b|\[\s*['"](realm|runtime)['"]\s*\]|\.\s*domains\s*\.\s*([A-Za-z_$][\w$]*))`,
      'gu',
    );
    for (const match of source.matchAll(aliasPattern)) {
      bindings.push(match[1] || match[2] || match[3]);
    }
  }

  const destructurePattern = /(?:const|let|var)\s*\{([\s\S]*?)\}\s*=\s*getPlatformClient\s*\([^)]*\)/gu;
  for (const match of source.matchAll(destructurePattern)) {
    for (const name of parseNamedList(match[1] || '')) {
      bindings.push(name);
    }
  }

  return bindings.filter(Boolean);
}

function bindingKind(binding) {
  const normalized = String(binding || '').trim();
  if (normalized === 'realm' || normalized.startsWith('realm')) return 'realm';
  if (normalized === 'runtime' || normalized.startsWith('runtime')) return 'runtime';
  return null;
}

const contractOrigins = parseSdkContractExportOrigins();

for (const filePath of walkFiles(featuresRoot)) {
  const fileRel = rel(filePath);
  const kind = surfaceKind(fileRel);
  if (!kind) continue;

  const source = fs.readFileSync(filePath, 'utf8');
  for (const usage of collectSdkContractNamedUsages(source)) {
    if (usage.startsWith('* as ')) {
      violations.push(`${fileRel}: ${kind} feature adapter must not namespace-import sdk-contract; named imports keep SDK origins auditable`);
      continue;
    }
    const origin = contractOrigins.get(usage);
    if (!origin) {
      violations.push(`${fileRel}: imports ${usage} from sdk-contract, but sdk-contract origin could not be classified`);
      continue;
    }
    if (kind === 'runtime' && origin === 'realm') {
      violations.push(`${fileRel}: runtime feature adapter imports Realm SDK contract symbol ${usage}`);
    }
    if (kind === 'realm' && origin === 'runtime') {
      violations.push(`${fileRel}: realm feature adapter imports Runtime SDK contract symbol ${usage}`);
    }
  }

  for (const binding of collectPlatformClientMemberBindings(source)) {
    const resolvedKind = bindingKind(binding);
    if (kind === 'runtime' && resolvedKind === 'realm') {
      violations.push(`${fileRel}: runtime feature adapter binds PlatformClient.${binding}`);
    }
    if (kind === 'realm' && resolvedKind === 'runtime') {
      violations.push(`${fileRel}: realm feature adapter binds PlatformClient.${binding}`);
    }
  }
}

if (violations.length > 0) {
  process.stderr.write(`Kit feature adapter boundary check failed:\n${violations.map((item) => `- ${item}`).join('\n')}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write('Kit feature adapter boundary check passed\n');
}
