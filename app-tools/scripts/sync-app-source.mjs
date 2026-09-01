#!/usr/bin/env node

// apps/lab is the hand-authored full-capability development Nimi App. This module bakes
// its source snapshot into templates/app-source/** so the published
// @nimiplatform/app-tools tarball can materialize admitted capability slices
// profile and reuse reviewed shell/auth glue for default starter profiles.
//
// The snapshot is a derived build artifact (gitignored, like dist/):
//   --apply           materialize templates/app-source/** + manifest (prepack)
//   resolveAppSource  the generator's source resolver — prefers a baked
//                     snapshot, else reads the live apps/lab tree, so in the
//                     monorepo there is exactly one copy and no build step.

import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  APP_SCAFFOLD_ADMITTED_MODULE_IDS,
  APP_SCAFFOLD_MODULE_REGISTRY,
  validateAppScaffoldModuleRegistry,
} from '../lib/app-scaffold-capabilities.mjs';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const APP_TOOLS_ROOT = path.resolve(SCRIPT_DIR, '..');
const SOURCE_APP_DIR = path.resolve(APP_TOOLS_ROOT, '../apps/lab');
const SNAPSHOT_DIR = path.resolve(APP_TOOLS_ROOT, 'templates/app-source');
const MANIFEST_PATH = path.resolve(APP_TOOLS_ROOT, 'templates/app-source.manifest.json');
const WORKBENCH_CORE_SOURCE_ROOT = 'src/workbench-core';

function sourceRootsForModuleIds(resolvedModuleIds) {
  validateAppScaffoldModuleRegistry();
  if (!Array.isArray(resolvedModuleIds)) {
    throw new Error('App scaffold source modules must be a canonical module id array');
  }
  const canonicalModuleIds = Object.values(APP_SCAFFOLD_MODULE_REGISTRY)
    .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id))
    .map((module) => module.id)
    .filter((id) => resolvedModuleIds.includes(id));
  if (JSON.stringify(resolvedModuleIds) !== JSON.stringify(canonicalModuleIds)) {
    throw new Error('App scaffold source modules must use canonical registry order without duplicates');
  }
  const selectedModuleIds = new Set(resolvedModuleIds);
  for (const id of resolvedModuleIds) {
    for (const dependency of APP_SCAFFOLD_MODULE_REGISTRY[id].requires) {
      if (!selectedModuleIds.has(dependency)) {
        throw new Error(`App scaffold source module closure is missing dependency: ${id} -> ${dependency}`);
      }
    }
  }
  const seen = new Set([WORKBENCH_CORE_SOURCE_ROOT]);
  const roots = [WORKBENCH_CORE_SOURCE_ROOT];
  for (const id of resolvedModuleIds) {
    const module = APP_SCAFFOLD_MODULE_REGISTRY[id];
    if (!module) throw new Error(`Unknown app scaffold source module: ${id}`);
    for (const mapping of module.sourceMappings) {
      if (seen.has(mapping.sourceRoot)) continue;
      seen.add(mapping.sourceRoot);
      roots.push(mapping.sourceRoot);
    }
  }
  return Object.freeze(roots);
}

// Directories never copied into the snapshot: build output, generated Tauri
// schema/icon assets, dependency state, and host-projection truth that init
// regenerates through nimicoding rather than the scaffold copy.
const EXCLUDED_DIRS = new Set([
  '.git',
  'node_modules',
  'dist',
  'dist-electron',
  'target',
  '.tmp',
  '.local',
  '.nimi',
  '.turbo',
  '.vite',
]);
const EXCLUDED_DIR_PATHS = new Set([
  'src-tauri/gen',
  'src-tauri/icons',
]);
// Files the generator emits structurally (identity/profile/version derived or a
// fixed scaffold asset), so they must not also live as a verbatim snapshot copy.
const STRUCTURED_FILE_PATHS = new Set([
  '.gitignore',
  '.github/workflows/ci.yml',
  'package.json',
  'src-tauri/Cargo.lock',
]);

// Nimi Lab's concrete identity literals. The generator string-replaces
// these with the target app identity at create time. Ordered longest-first so a
// shorter literal can never partially rewrite a longer one.
const SOURCE_IDENTITY = {
  tauriIdentifier: 'ai.nimi.apps.nimi.lab',
  packageName: '@nimiplatform/lab',
  cargoPackageName: 'nimiapp-lab-shell',
  appId: 'nimi.lab',
  appTitle: 'Nimi Lab',
  appSlug: 'nimi-lab',
  rendererEntryId: 'lab-app',
  accentPack: 'nimi-accent',
  devPort: '1468',
};

// Identity field => ordered replacement key. Order is by descending literal
// length, computed once so apply/check and the generator stay identical.
const IDENTITY_REPLACEMENT_ORDER = Object.entries(SOURCE_IDENTITY)
  .filter(([field]) => field !== 'rendererEntryId')
  .sort(([, left], [, right]) => right.length - left.length)
  .map(([field]) => field);

function isAppOwnedProductCode(relativePath) {
  if (relativePath.startsWith(`${WORKBENCH_CORE_SOURCE_ROOT}/`)) {
    return true;
  }
  for (const module of Object.values(APP_SCAFFOLD_MODULE_REGISTRY)) {
    if (module.sourceMappings.some((mapping) => relativePath.startsWith(`${mapping.sourceRoot}/`))) {
      return true;
    }
  }
  if (relativePath === 'src/shell/routes/product-area.tsx') {
    return true;
  }
  if (relativePath.startsWith('src/shell/ai/')) {
    return true;
  }
  if (relativePath === 'src/shell/routes/settings.tsx' || relativePath.startsWith('src/shell/routes/settings/')) {
    return true;
  }
  if (relativePath === 'src/dev-preview.tsx' || relativePath === 'dev-preview.html') {
    return true;
  }
  if (relativePath.startsWith('src/lab/')) {
    return true;
  }
  if (relativePath === 'src-tauri/src/world_tour.rs') {
    return true;
  }
  if (relativePath.startsWith('test/')) {
    return true;
  }
  return false;
}

function classifyFile(relativePath) {
  return isAppOwnedProductCode(relativePath) ? 'app-owned product code' : 'scaffold-managed glue';
}

function collectSnapshotFiles(sourceDir, resolvedModuleIds = APP_SCAFFOLD_ADMITTED_MODULE_IDS) {
  const files = [];
  const walk = (currentDir, relativeDir) => {
    const entries = readdirSync(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const relativePath = relativeDir ? `${relativeDir}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (EXCLUDED_DIRS.has(entry.name) || EXCLUDED_DIR_PATHS.has(relativePath)) {
          continue;
        }
        walk(path.join(currentDir, entry.name), relativePath);
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }
      if (STRUCTURED_FILE_PATHS.has(relativePath)) {
        continue;
      }
      files.push(relativePath);
    }
  };
  for (const sourceRoot of sourceRootsForModuleIds(resolvedModuleIds)) {
    const absoluteRoot = path.join(sourceDir, sourceRoot);
    if (!existsSync(absoluteRoot)) {
      throw new Error(`Scaffold product source missing: ${sourceRoot}`);
    }
    walk(absoluteRoot, sourceRoot);
  }
  return files.sort((left, right) => left.localeCompare(right));
}

function buildManifest(files, resolvedModuleIds = APP_SCAFFOLD_ADMITTED_MODULE_IDS) {
  sourceRootsForModuleIds(resolvedModuleIds);
  return {
    manifestVersion: 2,
    sourceApp: 'apps/lab',
    resolvedModules: [...resolvedModuleIds],
    sourceIdentity: SOURCE_IDENTITY,
    identityReplacementOrder: IDENTITY_REPLACEMENT_ORDER,
    files: files.map((relativePath) => ({
      path: relativePath,
      class: classifyFile(relativePath),
    })),
  };
}

function jsonFile(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function applySnapshot() {
  if (!existsSync(SOURCE_APP_DIR)) {
    throw new Error(`Nimi Lab source missing: ${SOURCE_APP_DIR}`);
  }
  const resolvedModuleIds = APP_SCAFFOLD_ADMITTED_MODULE_IDS;
  const files = collectSnapshotFiles(SOURCE_APP_DIR, resolvedModuleIds);
  rmSync(SNAPSHOT_DIR, { recursive: true, force: true });
  mkdirSync(SNAPSHOT_DIR, { recursive: true });
  for (const relativePath of files) {
    const targetPath = path.join(SNAPSHOT_DIR, relativePath);
    mkdirSync(path.dirname(targetPath), { recursive: true });
    cpSync(path.join(SOURCE_APP_DIR, relativePath), targetPath);
  }
  // The baked snapshot is MIT distribution material; LICENSE is packaging
  // metadata and never enters the scaffold source manifest.
  cpSync(path.join(SOURCE_APP_DIR, 'LICENSE'), path.join(SNAPSHOT_DIR, 'LICENSE'));
  writeFileSync(MANIFEST_PATH, jsonFile(buildManifest(files, resolvedModuleIds)));
  return files;
}

// Source resolver used by the generator. In the monorepo it reads apps/lab
// live so scaffold checks exercise the second consumer directly.
// Published tarballs fall back to the baked snapshot because apps/lab is not
// present.
function resolveAppSource({ resolvedModuleIds = APP_SCAFFOLD_ADMITTED_MODULE_IDS } = {}) {
  const requestedModuleIds = [...resolvedModuleIds];
  if (existsSync(SOURCE_APP_DIR)) {
    const files = collectSnapshotFiles(SOURCE_APP_DIR, requestedModuleIds);
    return {
      baseDir: SOURCE_APP_DIR,
      manifest: buildManifest(files, requestedModuleIds),
    };
  }
  if (existsSync(SNAPSHOT_DIR) && existsSync(MANIFEST_PATH)) {
    const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
    if (manifest?.manifestVersion !== 2 || !Array.isArray(manifest?.resolvedModules)) {
      throw new Error('Unsupported baked app-source manifest');
    }
    for (const id of requestedModuleIds) {
      if (!manifest.resolvedModules.includes(id)) {
        throw new Error(`Baked app-source snapshot does not contain requested module: ${id}`);
      }
    }
    return {
      baseDir: SNAPSHOT_DIR,
      manifest,
    };
  }
  throw new Error(`No baked app-source snapshot and Nimi Lab source missing: ${SOURCE_APP_DIR}`);
}

function readAppSourceFile(baseDir, relativePath) {
  return readFileSync(path.join(baseDir, relativePath), 'utf8');
}

export {
  APP_TOOLS_ROOT,
  IDENTITY_REPLACEMENT_ORDER,
  MANIFEST_PATH,
  SNAPSHOT_DIR,
  SOURCE_APP_DIR,
  SOURCE_IDENTITY,
  STRUCTURED_FILE_PATHS,
  WORKBENCH_CORE_SOURCE_ROOT,
  applySnapshot,
  buildManifest,
  classifyFile,
  collectSnapshotFiles,
  readAppSourceFile,
  resolveAppSource,
  sourceRootsForModuleIds,
};

function main(argv) {
  if (!argv.includes('--apply')) {
    process.stderr.write('Usage: sync-app-source.mjs --apply\n');
    process.exit(1);
  }
  const files = applySnapshot();
  process.stdout.write(`[sync-app-source] baked ${files.length} files from apps/lab into templates/app-source\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || 'unknown error');
    process.stderr.write(`[sync-app-source] failed: ${message}\n`);
    process.exit(1);
  }
}
