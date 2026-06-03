#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { readYamlWithFragments } from './lib/read-yaml-with-fragments.mjs';

const root = process.cwd();
const tablePath = '.nimi/spec/platform/kernel/tables/nimi-app-identity-surfaces.yaml';
const table = readYamlWithFragments(path.join(root, tablePath));
const rows = Array.isArray(table?.apps) ? table.apps : [];
const appIdPattern = new RegExp(String(table?.identity_schema?.app_id_pattern || ''));
const tauriPrefix = String(table?.identity_schema?.tauri_identifier_prefix || '').trim();
const violations = [];

const excludedDirs = new Set(['node_modules', 'dist', 'target', '.git', '.tmp', '.turbo', '.vite']);

function fail(message) {
  violations.push(message);
}

function readText(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

function exists(rel) {
  return fs.existsSync(path.join(root, rel));
}

function listFiles(relDir) {
  const absDir = path.join(root, relDir);
  if (!fs.existsSync(absDir)) return [];
  const output = [];
  const stack = [absDir];
  while (stack.length > 0) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (excludedDirs.has(entry.name)) continue;
      const abs = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(abs);
      } else if (entry.isFile()) {
        output.push(path.relative(root, abs));
      }
    }
  }
  return output;
}

function parseJson(rel) {
  try {
    return JSON.parse(readText(rel));
  } catch (error) {
    fail(`${rel}: must parse as JSON (${error instanceof Error ? error.message : String(error)})`);
    return null;
  }
}

function requiredString(row, field) {
  const value = String(row?.[field] || '').trim();
  if (!value) fail(`${tablePath}: app identity row missing ${field}`);
  return value;
}

function expectedTauriIdentifier(appId) {
  return `${tauriPrefix}.${appId}`;
}

if (!rows.length) {
  fail(`${tablePath}: apps must not be empty`);
}

const seenAppIds = new Set();

for (const row of rows) {
  const sourceRoot = requiredString(row, 'source_root');
  const appId = requiredString(row, 'canonical_app_id');
  const sdkAppId = requiredString(row, 'sdk_app_id');
  const runtimeAppId = requiredString(row, 'runtime_app_id');
  const npmPackage = requiredString(row, 'npm_package');
  const tauriRequired = row?.tauri_identifier_required === true;
  const tauriIdentifier = row?.tauri_identifier === null ? null : String(row?.tauri_identifier || '').trim();

  if (seenAppIds.has(appId)) {
    fail(`${tablePath}: duplicate canonical_app_id ${appId}`);
  }
  seenAppIds.add(appId);

  if (!appIdPattern.test(appId)) {
    fail(`${tablePath}: ${appId} does not match app_id_pattern`);
  }
  if (sdkAppId !== appId) {
    fail(`${tablePath}: ${sourceRoot} sdk_app_id must equal canonical_app_id`);
  }
  if (runtimeAppId !== appId) {
    fail(`${tablePath}: ${sourceRoot} runtime_app_id must equal canonical_app_id`);
  }

  const packageJsonPath = `${sourceRoot}/package.json`;
  if (exists(packageJsonPath)) {
    const packageJson = parseJson(packageJsonPath);
    if (packageJson && packageJson.name !== npmPackage) {
      fail(`${packageJsonPath}: package name ${packageJson.name} must equal ${npmPackage}`);
    }
  }

  const manifestPath = `${sourceRoot}/nimi.app.yaml`;
  if (exists(manifestPath) && !new RegExp(`^app_id:\\s*${appId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'm').test(readText(manifestPath))) {
    fail(`${manifestPath}: app_id must be ${appId}`);
  }

  const runtimePlatformPath = `${sourceRoot}/src/shell/auth/runtime-platform.ts`;
  if (exists(runtimePlatformPath) && !new RegExp(`export\\s+const\\s+appId\\s*=\\s*['"]${appId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"]`).test(readText(runtimePlatformPath))) {
    fail(`${runtimePlatformPath}: exported appId must be ${appId}`);
  }

  const tauriConfigPath = `${sourceRoot}/src-tauri/tauri.conf.json`;
  if (tauriRequired) {
    const expected = expectedTauriIdentifier(appId);
    if (tauriIdentifier !== expected) {
      fail(`${tablePath}: ${sourceRoot} tauri_identifier must be ${expected}`);
    }
    if (!exists(tauriConfigPath)) {
      fail(`${sourceRoot}: tauri_identifier_required=true but src-tauri/tauri.conf.json is missing`);
    } else {
      const tauri = parseJson(tauriConfigPath);
      if (tauri && tauri.identifier !== expected) {
        fail(`${tauriConfigPath}: identifier ${tauri.identifier} must be ${expected}`);
      }
    }
  } else if (tauriIdentifier !== null) {
    fail(`${tablePath}: ${sourceRoot} tauri_identifier must be null when tauri_identifier_required=false`);
  }

  const suffix = appId.startsWith('nimi.') ? appId.slice('nimi.'.length) : appId;
  const forbiddenLiterals = [
    `app.nimi.${suffix}`,
    `dev.nimi.${suffix}`,
  ];
  for (const rel of listFiles(sourceRoot)) {
    const content = readText(rel);
    for (const forbidden of forbiddenLiterals) {
      if (content.includes(forbidden)) {
        fail(`${rel}: active app identity must not use forbidden side namespace ${forbidden}`);
      }
    }
  }
}

const testerRow = rows.find((row) => row?.source_root === 'apps/tester');
if (testerRow) {
  const testerAppId = String(testerRow.canonical_app_id || '').trim();
  const testerTauri = expectedTauriIdentifier(testerAppId);
  const syncSource = readText('app-tools/scripts/sync-app-source.mjs');
  if (!syncSource.includes(`appId: '${testerAppId}'`)) {
    fail('app-tools/scripts/sync-app-source.mjs: SOURCE_IDENTITY.appId must match apps/tester canonical_app_id');
  }
  if (!syncSource.includes(`tauriIdentifier: '${testerTauri}'`)) {
    fail('app-tools/scripts/sync-app-source.mjs: SOURCE_IDENTITY.tauriIdentifier must match derived tester Tauri identifier');
  }
}

const scaffoldSource = readText('app-tools/lib/app-scaffold.mjs');
if (!scaffoldSource.includes('return `ai.nimi.apps.${suffix || DEFAULT_APP_ID}`;')) {
  fail('app-tools/lib/app-scaffold.mjs: tauriIdentifierFromAppId must derive ai.nimi.apps.<app_id> losslessly');
}
if (scaffoldSource.includes("replace(/-/g, '.')") || scaffoldSource.includes('replace(/-/g, ".")')) {
  fail('app-tools/lib/app-scaffold.mjs: app id hyphens must not be rewritten in Tauri identifiers');
}

if (violations.length > 0) {
  process.stderr.write(`check-app-identity-surfaces failed:\n${violations.map((item) => `- ${item}`).join('\n')}\n`);
  process.exit(1);
}

process.stdout.write('check-app-identity-surfaces passed\n');
