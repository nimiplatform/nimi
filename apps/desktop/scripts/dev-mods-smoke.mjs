#!/usr/bin/env node
/* global process */

import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  resolveModsRoot,
  resolveRuntimeModsDir,
  sameNormalizedPath,
} from './mod-paths.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.resolve(__dirname, '..');

function parseArgs(argv) {
  const options = {
    mod: 'local-chat',
    all: false,
    skipPrepare: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--') {
      continue;
    }
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
    if (token === '--skip-prepare-default-resources') {
      options.skipPrepare = true;
      continue;
    }
    if (token === '--help' || token === '-h') {
      process.stdout.write(
        [
          'Usage: node scripts/dev-mods-smoke.mjs [--mod <id>] [--skip-prepare-default-resources]',
          '       node scripts/dev-mods-smoke.mjs --all [--skip-prepare-default-resources]',
          '',
          'Options:',
          '  --mod <id>                         Target mod id, default: local-chat',
          '  --all                              Run smoke preparation for all desktop-loadable first-party mods',
          '  --skip-prepare-default-resources   Skip desktop default-mod resources copy step',
          '',
        ].join('\n'),
      );
      process.exit(0);
    }
    throw new Error(`Unknown argument: ${token}`);
  }

  return options;
}

const LOADABLE_MOD_IDS = [
  'audio-book',
  'kismet',
  'knowledge-base',
  'local-chat',
  'mint-you',
  'test-chat-tts',
  'textplay',
  'videoplay',
  'world-studio',
];

function ensureFile(filePath, label) {
  if (!existsSync(filePath)) {
    throw new Error(`Missing ${label}: ${filePath}`);
  }
  if (!statSync(filePath).isFile()) {
    throw new Error(`${label} must be a file: ${filePath}`);
  }
}

function ensureDir(dirPath, label) {
  if (!existsSync(dirPath)) {
    throw new Error(`Missing ${label}: ${dirPath}`);
  }
  if (!statSync(dirPath).isDirectory()) {
    throw new Error(`${label} must be a directory: ${dirPath}`);
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

function runNodeScript(scriptPath, args, cwd) {
  const result = spawnSync(process.execPath, [scriptPath, ...args], {
    cwd,
    stdio: 'inherit',
    env: process.env,
  });
  if (result.status !== 0) {
    throw new Error(`Command failed: node ${scriptPath} ${args.join(' ')}`);
  }
}

function smokeSingleMod(options, modsRoot, runtimeModsDir) {
  const modDir = path.join(modsRoot, options.mod);
  ensureDir(modDir, `mod directory (${options.mod})`);
  const manifestPath = findManifestPath(modDir);
  if (!manifestPath) {
    throw new Error(`Missing mod manifest under ${modDir}`);
  }

  const buildScriptPath = path.join(modsRoot, 'scripts', 'build-mod.mjs');
  ensureFile(buildScriptPath, 'build script');

  process.stdout.write(`[dev-mods-smoke] env ok: NIMI_MODS_ROOT=${modsRoot}\n`);
  process.stdout.write(
    `[dev-mods-smoke] env ok: NIMI_RUNTIME_MODS_DIR=${runtimeModsDir}\n`,
  );

  process.stdout.write(`[dev-mods-smoke] building mod "${options.mod}"...\n`);
  runNodeScript(buildScriptPath, ['--mod', options.mod], modsRoot);

  const distEntry = path.join(modDir, 'dist', 'mods', options.mod, 'index.js');
  ensureFile(distEntry, `mod dist entry (${options.mod})`);
  process.stdout.write(`[dev-mods-smoke] build output ok: ${distEntry}\n`);

  if (!options.skipPrepare) {
    const prepareScriptPath = path.join(desktopRoot, 'scripts', 'prepare-default-mods.mjs');
    ensureFile(prepareScriptPath, 'prepare-default-mods script');
    process.stdout.write('[dev-mods-smoke] syncing desktop default-mod resources...\n');
    runNodeScript(prepareScriptPath, [], desktopRoot);

    const defaultModDir = path.join(
      desktopRoot,
      'src-tauri',
      'resources',
      'default-mods',
      options.mod,
    );
    ensureDir(defaultModDir, `desktop default-mod directory (${options.mod})`);

    const copiedManifestPath = findManifestPath(defaultModDir);
    if (!copiedManifestPath) {
      throw new Error(`Missing copied manifest in ${defaultModDir}`);
    }
    const copiedDistEntry = path.join(defaultModDir, 'dist', 'mods', options.mod, 'index.js');
    ensureFile(copiedDistEntry, `desktop default-mod dist entry (${options.mod})`);
    process.stdout.write(`[dev-mods-smoke] resources manifest ok: ${copiedManifestPath}\n`);
    process.stdout.write(`[dev-mods-smoke] resources dist ok: ${copiedDistEntry}\n`);
  }
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const modsRoot = resolveModsRoot({ required: true, mustExist: true });
  const runtimeModsDir = resolveRuntimeModsDir({ required: true, mustExist: true });

  if (!sameNormalizedPath(modsRoot, runtimeModsDir)) {
    throw new Error(
      [
        'NIMI_RUNTIME_MODS_DIR must equal NIMI_MODS_ROOT in local joint-debug.',
        `NIMI_MODS_ROOT=${modsRoot}`,
        `NIMI_RUNTIME_MODS_DIR=${runtimeModsDir}`,
      ].join('\n'),
    );
  }

  const targetMods = options.all ? LOADABLE_MOD_IDS : [options.mod];
  for (const modId of targetMods) {
    smokeSingleMod({
      ...options,
      mod: modId,
    }, modsRoot, runtimeModsDir);
  }

  process.stdout.write(
    [
      '[dev-mods-smoke] smoke check passed.',
      `mods=${targetMods.join(', ')}`,
      `next: pnpm -C ${desktopRoot} run dev:shell`,
      '',
    ].join('\n'),
  );
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`[dev-mods-smoke] failed: ${message}\n`);
  process.exit(1);
}
