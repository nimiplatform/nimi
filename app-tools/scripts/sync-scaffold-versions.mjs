#!/usr/bin/env node

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { validateAppScaffoldCargoDependencyValue } from '../lib/app-scaffold-capabilities.mjs';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const APP_TOOLS_ROOT = path.resolve(SCRIPT_DIR, '..');
const REPO_ROOT = path.resolve(APP_TOOLS_ROOT, '..');
const APP_TOOLS_MANIFEST_PATH = path.join(APP_TOOLS_ROOT, 'package.json');

function readJson(relativePath) {
  return JSON.parse(readFileSync(path.join(REPO_ROOT, relativePath), 'utf8'));
}

function requiredString(value, label) {
  if (typeof value !== 'string' || !value.trim() || value !== value.trim()) {
    throw new Error(`Scaffold version source is invalid: ${label}`);
  }
  return value;
}

function publicPackageRange(manifest, label) {
  return `^${requiredString(manifest.version, `${label}.version`)}`;
}

function nimiShellTauriVersion() {
  const cargo = readFileSync(path.join(REPO_ROOT, 'kit/shell/tauri/Cargo.toml'), 'utf8');
  if (!/^name\s*=\s*"nimi-shell-tauri"\s*$/mu.test(cargo)) {
    throw new Error('Scaffold version source is invalid: kit/shell/tauri package name');
  }
  const match = cargo.match(/^version\s*=\s*"([^"]+)"\s*$/mu);
  const version = requiredString(match?.[1], 'kit/shell/tauri.version');
  validateAppScaffoldCargoDependencyValue(version, 'kit/shell/tauri.version');
  return version;
}

export function buildScaffoldVersionProjection() {
  const rootManifest = readJson('package.json');
  const appToolsManifest = readJson('app-tools/package.json');
  const sdkManifest = readJson('sdks/typescript/package.json');
  const kitManifest = readJson('kit/package.json');
  const current = appToolsManifest.nimiScaffoldVersions;
  if (!current || typeof current !== 'object' || Array.isArray(current)) {
    throw new Error('app-tools package manifest is missing nimiScaffoldVersions');
  }
  return Object.freeze({
    ...current,
    sdkVersion: publicPackageRange(sdkManifest, '@nimiplatform/sdk'),
    appToolsVersion: publicPackageRange(appToolsManifest, '@nimiplatform/app-tools'),
    nimicodingVersion: requiredString(
      rootManifest.devDependencies?.['@nimiplatform/nimi-coding'],
      'root.devDependencies.@nimiplatform/nimi-coding',
    ),
    kitVersion: publicPackageRange(kitManifest, '@nimiplatform/kit'),
    nimiShellTauriVersion: nimiShellTauriVersion(),
    packageManager: requiredString(rootManifest.packageManager, 'root.packageManager'),
  });
}

export function syncScaffoldVersionProjection({ apply }) {
  const appToolsManifest = readJson('app-tools/package.json');
  const expected = buildScaffoldVersionProjection();
  if (JSON.stringify(appToolsManifest.nimiScaffoldVersions) === JSON.stringify(expected)) {
    return { changed: false, projection: expected };
  }
  if (!apply) throw new Error('app-tools nimiScaffoldVersions is stale; run pnpm --filter @nimiplatform/app-tools build');
  appToolsManifest.nimiScaffoldVersions = expected;
  writeFileSync(APP_TOOLS_MANIFEST_PATH, `${JSON.stringify(appToolsManifest, null, 2)}\n`);
  return { changed: true, projection: expected };
}

function main(argv) {
  const apply = argv.includes('--apply');
  const check = argv.includes('--check');
  if (apply === check) throw new Error('Usage: sync-scaffold-versions.mjs --apply | --check');
  const result = syncScaffoldVersionProjection({ apply });
  process.stdout.write(`[sync-scaffold-versions] ${result.changed ? 'updated' : 'verified'} app-tools package projection\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || 'unknown error');
    process.stderr.write(`[sync-scaffold-versions] failed: ${message}\n`);
    process.exit(1);
  }
}
