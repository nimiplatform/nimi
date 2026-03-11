#!/usr/bin/env node
/* global process */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { resolveRuntimeModsDir } from './mod-paths.mjs';

function parseArgs(argv) {
  const options = {
    mod: '',
    all: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--mod') {
      const value = String(argv[index + 1] || '').trim();
      if (!value || value.startsWith('--')) {
        throw new Error('Missing value after --mod');
      }
      options.mod = value;
      index += 1;
      continue;
    }
    if (token === '--all') {
      options.all = true;
      continue;
    }
    if (token === '--help' || token === '-h') {
      process.stdout.write(
        [
          'Usage: node scripts/dev-mods-smoke.mjs [--mod <id>]',
          '       node scripts/dev-mods-smoke.mjs --all',
          '',
          'Checks installed runtime mods under NIMI_RUNTIME_MODS_DIR.',
        ].join('\n'),
      );
      process.exit(0);
    }
    throw new Error(`Unknown argument: ${token}`);
  }

  return options;
}

function ensureDir(dirPath, label) {
  if (!existsSync(dirPath)) {
    throw new Error(`Missing ${label}: ${dirPath}`);
  }
  if (!statSync(dirPath).isDirectory()) {
    throw new Error(`${label} must be a directory: ${dirPath}`);
  }
}

function ensureFile(filePath, label) {
  if (!existsSync(filePath)) {
    throw new Error(`Missing ${label}: ${filePath}`);
  }
  if (!statSync(filePath).isFile()) {
    throw new Error(`${label} must be a file: ${filePath}`);
  }
}

function findManifestPath(modDir) {
  const candidates = ['mod.manifest.yaml', 'mod.manifest.yml', 'mod.manifest.json'];
  for (const filename of candidates) {
    const candidate = path.join(modDir, filename);
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

function readManifestSummary(manifestPath) {
  const content = readFileSync(manifestPath, 'utf8');
  if (manifestPath.endsWith('.json')) {
    return JSON.parse(content);
  }

  const summary = {};
  for (const line of content.split('\n')) {
    const match = line.match(/^([A-Za-z][A-Za-z0-9_-]*):\s*(.+)$/);
    if (!match) continue;
    summary[match[1]] = match[2].trim();
  }
  return summary;
}

function checkSingleMod(runtimeModsDir, modDirName) {
  const modDir = path.join(runtimeModsDir, modDirName);
  ensureDir(modDir, `runtime mod directory (${modDirName})`);
  const manifestPath = findManifestPath(modDir);
  if (!manifestPath) {
    throw new Error(`Missing mod manifest under ${modDir}`);
  }

  const manifest = readManifestSummary(manifestPath);
  const modId = String(manifest.id || '').trim();
  const entry = String(manifest.entry || '').trim();
  if (!modId) {
    throw new Error(`Manifest id missing: ${manifestPath}`);
  }
  if (!entry) {
    throw new Error(`Manifest entry missing: ${manifestPath}`);
  }
  ensureFile(path.join(modDir, entry), `runtime mod entry (${modId})`);
  process.stdout.write(`[dev-mods-smoke] manifest ok: ${manifestPath}\n`);
  process.stdout.write(`[dev-mods-smoke] entry ok: ${path.join(modDir, entry)}\n`);
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const runtimeModsDir = resolveRuntimeModsDir({ required: true, mustExist: true });
  ensureDir(runtimeModsDir, 'runtime mods dir');
  const installedDirNames = readdirSync(runtimeModsDir)
    .filter((name) => isExistingDirectory(path.join(runtimeModsDir, name)));
  const targetDirNames = options.all
    ? installedDirNames
    : [options.mod || installedDirNames[0] || ''];

  process.stdout.write(`[dev-mods-smoke] NIMI_RUNTIME_MODS_DIR=${runtimeModsDir}\n`);
  if (targetDirNames.length === 0 || !targetDirNames[0]) {
    process.stdout.write('[dev-mods-smoke] no runtime mods found; empty-state host is valid.\n');
    return;
  }
  for (const modDirName of targetDirNames) {
    checkSingleMod(runtimeModsDir, modDirName);
  }

  process.stdout.write(
    [
      '[dev-mods-smoke] smoke check passed.',
      `mods=${targetDirNames.join(', ')}`,
      '',
    ].join('\n'),
  );
}

function isExistingDirectory(inputPath) {
  return existsSync(inputPath) && statSync(inputPath).isDirectory();
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`[dev-mods-smoke] failed: ${message}\n`);
  process.exit(1);
}
