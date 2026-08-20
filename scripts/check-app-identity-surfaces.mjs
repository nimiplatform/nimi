#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { readYamlWithFragments } from './lib/read-yaml-with-fragments.mjs';

const root = process.cwd();
const tablePath = 'config/platform-nimi-app-identity-surfaces.yaml';
const table = readYamlWithFragments(path.join(root, tablePath));
const rows = Array.isArray(table?.apps) ? table.apps : [];
const appIdPattern = new RegExp(String(table?.identity_schema?.app_id_pattern || ''));
const nativeBundlePrefix = String(
  table?.identity_schema?.native_bundle_identifier_prefix || '',
).trim();
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

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function resolveLocalModule(rel, specifier) {
  if (!specifier.startsWith('.')) return null;
  const absBase = path.resolve(path.dirname(path.join(root, rel)), specifier);
  const candidates = [
    absBase,
    absBase.endsWith('.js') ? `${absBase.slice(0, -3)}.ts` : `${absBase}.ts`,
    path.join(absBase, 'index.ts'),
  ];
  for (const abs of candidates) {
    const resolved = path.relative(root, abs);
    if (resolved.startsWith('..') || path.isAbsolute(resolved)) continue;
    if (exists(resolved)) return resolved;
  }
  return null;
}

function exportedName(exportItem) {
  const [localName, aliasName] = exportItem.split(/\s+as\s+/).map((part) => part.trim());
  return aliasName || localName;
}

function fileExportsAppId(rel, appId, seen = new Set()) {
  if (seen.has(rel) || !exists(rel)) return false;
  seen.add(rel);

  const source = readText(rel);
  const escapedAppId = escapeRegExp(appId);
  if (new RegExp(`export\\s+const\\s+appId\\s*=\\s*['"]${escapedAppId}['"]`).test(source)) {
    return true;
  }

  const reExportPattern = /export\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"]/g;
  for (const match of source.matchAll(reExportPattern)) {
    const exportedItems = match[1].split(',').map((item) => item.trim()).filter(Boolean);
    if (!exportedItems.some((item) => exportedName(item) === 'appId')) continue;
    const resolved = resolveLocalModule(rel, match[2]);
    if (resolved && fileExportsAppId(resolved, appId, seen)) return true;
  }

  return false;
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

function expectedNativeBundleIdentifier(appId) {
  return `${nativeBundlePrefix}.${appId}`;
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
  const nativeShell = requiredString(row, 'native_shell');
  const nativeBundleRequired = row?.native_bundle_identifier_required === true;
  const nativeBundleIdentifier = row?.native_bundle_identifier === null
    ? null
    : String(row?.native_bundle_identifier || '').trim();

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
  if (exists(manifestPath) && !new RegExp(`^app_id:\\s*${escapeRegExp(appId)}\\s*$`, 'm').test(readText(manifestPath))) {
    fail(`${manifestPath}: app_id must be ${appId}`);
  }

  const runtimePlatformPath = `${sourceRoot}/src/shell/auth/runtime-platform.ts`;
  if (exists(runtimePlatformPath) && !fileExportsAppId(runtimePlatformPath, appId)) {
    fail(`${runtimePlatformPath}: exported appId must be ${appId}`);
  }

  const tauriConfigPath = `${sourceRoot}/src-tauri/tauri.conf.json`;
  if (!['electron', 'none', 'tauri'].includes(nativeShell)) {
    fail(`${tablePath}: ${sourceRoot} native_shell must be electron, tauri, or none`);
  }
  if (nativeBundleRequired) {
    const expected = expectedNativeBundleIdentifier(appId);
    if (nativeBundleIdentifier !== expected) {
      fail(`${tablePath}: ${sourceRoot} native_bundle_identifier must be ${expected}`);
    }
    if (nativeShell === 'tauri' && !exists(tauriConfigPath)) {
      fail(`${sourceRoot}: native_shell=tauri but src-tauri/tauri.conf.json is missing`);
    } else if (nativeShell === 'tauri') {
      const tauri = parseJson(tauriConfigPath);
      if (tauri && tauri.identifier !== expected) {
        fail(`${tauriConfigPath}: identifier ${tauri.identifier} must be ${expected}`);
      }
    }
    if (nativeShell === 'electron') {
      const electronMainPath = `${sourceRoot}/src-electron/main.ts`;
      const electronPackagePath = `${sourceRoot}/scripts/build-macos-electron-release.mjs`;
      if (!exists(electronMainPath) || !exists(electronPackagePath)) {
        fail(`${sourceRoot}: native_shell=electron requires the Electron main and package builder`);
      } else if (!readText(electronPackagePath).includes(`: '${expected}'`)) {
        fail(`${electronPackagePath}: production appBundleId must be ${expected}`);
      }
      if (exists(tauriConfigPath)) {
        fail(`${sourceRoot}: native_shell=electron must not retain a Desktop Tauri product carrier`);
      }
    }
  } else {
    if (nativeBundleIdentifier !== null) {
      fail(`${tablePath}: ${sourceRoot} native_bundle_identifier must be null when not required`);
    }
    if (nativeShell !== 'none') {
      fail(`${tablePath}: ${sourceRoot} native_shell must be none when no native bundle is admitted`);
    }
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

const labRow = rows.find((row) => row?.source_root === 'apps/lab');
if (labRow) {
  const labAppId = String(labRow.canonical_app_id || '').trim();
  const labTauri = expectedNativeBundleIdentifier(labAppId);
  const syncSource = readText('app-tools/scripts/sync-app-source.mjs');
  if (!syncSource.includes(`appId: '${labAppId}'`)) {
    fail('app-tools/scripts/sync-app-source.mjs: SOURCE_IDENTITY.appId must match apps/lab canonical_app_id');
  }
  if (!syncSource.includes(`tauriIdentifier: '${labTauri}'`)) {
    fail('app-tools/scripts/sync-app-source.mjs: SOURCE_IDENTITY.tauriIdentifier must match derived Lab Tauri identifier');
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
