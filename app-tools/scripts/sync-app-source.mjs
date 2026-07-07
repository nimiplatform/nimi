#!/usr/bin/env node

// apps/tester is the hand-authored proof/reference Nimi App. This module bakes
// its source snapshot into templates/app-source/** so the published
// @nimiplatform/app-tools tarball can materialize the explicit tester-reference
// profile and reuse reviewed shell/auth glue for default starter profiles.
//
// The snapshot is a derived build artifact (gitignored, like dist/):
//   --apply           materialize templates/app-source/** + manifest (prepack)
//   resolveAppSource  the generator's source resolver — prefers a baked
//                     snapshot, else reads the live apps/tester tree, so in the
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

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const APP_TOOLS_ROOT = path.resolve(SCRIPT_DIR, '..');
const SOURCE_APP_DIR = path.resolve(APP_TOOLS_ROOT, '../apps/tester');
const SNAPSHOT_DIR = path.resolve(APP_TOOLS_ROOT, 'templates/app-source');
const MANIFEST_PATH = path.resolve(APP_TOOLS_ROOT, 'templates/app-source.manifest.json');

// Directories never copied into the snapshot: build output, generated Tauri
// schema/icon assets, dependency state, and host-projection truth that init
// regenerates through nimicoding rather than the scaffold copy.
const EXCLUDED_DIRS = new Set([
  '.git',
  'node_modules',
  'dist',
  'target',
  '.tmp',
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

// The reference app's concrete identity literals. The generator string-replaces
// these with the target app identity at create time. Ordered longest-first so a
// shorter literal can never partially rewrite a longer one.
const SOURCE_IDENTITY = {
  tauriIdentifier: 'ai.nimi.apps.nimi.tester',
  packageName: '@nimiplatform/tester',
  cargoPackageName: 'nimiapp-tester-shell',
  appId: 'nimi.tester',
  appTitle: 'Nimi Lab',
  appSlug: 'nimi-tester',
  rendererEntryId: 'tester-app',
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
  if (relativePath.startsWith('src/tester/')) {
    return true;
  }
  if (relativePath === 'src-tauri/src/world_tour.rs') {
    return true;
  }
  if (relativePath.startsWith('test/') && relativePath !== 'test/scaffold-boundary.test.mjs') {
    return true;
  }
  return false;
}

function classifyFile(relativePath) {
  return isAppOwnedProductCode(relativePath) ? 'app-owned product code' : 'scaffold-managed glue';
}

function collectSnapshotFiles(sourceDir) {
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
  walk(sourceDir, '');
  return files.sort((left, right) => left.localeCompare(right));
}

function buildManifest(files) {
  return {
    manifestVersion: 1,
    sourceApp: 'apps/tester',
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
    throw new Error(`Reference app source missing: ${SOURCE_APP_DIR}`);
  }
  const files = collectSnapshotFiles(SOURCE_APP_DIR);
  rmSync(SNAPSHOT_DIR, { recursive: true, force: true });
  mkdirSync(SNAPSHOT_DIR, { recursive: true });
  for (const relativePath of files) {
    const targetPath = path.join(SNAPSHOT_DIR, relativePath);
    mkdirSync(path.dirname(targetPath), { recursive: true });
    cpSync(path.join(SOURCE_APP_DIR, relativePath), targetPath);
  }
  writeFileSync(MANIFEST_PATH, jsonFile(buildManifest(files)));
  return files;
}

// Source resolver used by the generator. In the monorepo it reads apps/tester
// live so scaffold checks exercise the second consumer proof directly.
// Published tarballs fall back to the baked snapshot because apps/tester is not
// present.
function resolveAppSource() {
  if (existsSync(SOURCE_APP_DIR)) {
    return {
      baseDir: SOURCE_APP_DIR,
      manifest: buildManifest(collectSnapshotFiles(SOURCE_APP_DIR)),
    };
  }
  if (existsSync(SNAPSHOT_DIR) && existsSync(MANIFEST_PATH)) {
    return {
      baseDir: SNAPSHOT_DIR,
      manifest: JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')),
    };
  }
  throw new Error(`No baked app-source snapshot and reference app missing: ${SOURCE_APP_DIR}`);
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
  applySnapshot,
  buildManifest,
  classifyFile,
  collectSnapshotFiles,
  readAppSourceFile,
  resolveAppSource,
};

function main(argv) {
  if (!argv.includes('--apply')) {
    process.stderr.write('Usage: sync-app-source.mjs --apply\n');
    process.exit(1);
  }
  const files = applySnapshot();
  process.stdout.write(`[sync-app-source] baked ${files.length} files from apps/tester into templates/app-source\n`);
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
