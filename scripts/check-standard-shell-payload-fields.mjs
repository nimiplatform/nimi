import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Standard shell payload boundary guard (platform P-KIT-041C / P-KIT-041F).
//
// The kit standard shell hosts already fail closed at runtime on renderer-carried
// storage-root fields (Electron `assertNoRendererStorageRootFields`, Tauri
// `parse_standard_storage_payload`). This static gate stops app renderer code
// from reconstructing the migrated-away patterns, and stops Electron IPC handlers
// from leaking raw `file://` URLs back to the renderer (which the host cannot
// fail-close, because the value is a plausible string).

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const apps = ['desktop', 'tester', 'avatar', 'zhiyu'];
const failures = [];

// The six forbidden renderer storage-root fields (platform
// standard-shell-capabilities.yaml `forbidden_renderer_fields`). `dataRoot`,
// `cacheRoot`, `tempRoot`, `root`, and `absolutePath` are generic identifiers
// with legitimate renderer uses (product-control data-root selection, type
// declarations, i18n labels), so a blanket static scan of them false-positives.
// The authoritative enforcement is the fail-closed runtime assertion in both
// kit hosts; this guard verifies that assertion set stays complete so the
// enforcement can never be silently weakened.
const REQUIRED_FORBIDDEN_STORAGE_ROOT_FIELDS = [
  'storageRoot',
  'root',
  'absolutePath',
  'dataRoot',
  'cacheRoot',
  'tempRoot',
];

verifyHostForbidsAllStorageRootFields(
  'kit/shell/electron/src/main/paths.ts',
  /function assertNoRendererStorageRootFields[\s\S]*?for \(const field of \[([^\]]*)\]/u,
);
verifyHostForbidsAllStorageRootFields(
  'kit/shell/tauri/src/runtime_app_storage.rs',
  /FORBIDDEN_RENDERER_STORAGE_ROOT_FIELDS[^=]*=\s*&\[([^\]]*)\]/u,
);

function verifyHostForbidsAllStorageRootFields(relativePath, pattern) {
  const absolutePath = path.join(repoRoot, relativePath);
  if (!existsSync(absolutePath)) {
    failures.push(`${relativePath}: missing kit host storage-root forbidden-field assertion source`);
    return;
  }
  const content = readFileSync(absolutePath, 'utf8');
  const match = content.match(pattern);
  if (!match) {
    failures.push(`${relativePath}: could not locate the renderer storage-root forbidden-field list`);
    return;
  }
  const declared = new Set(
    [...match[1].matchAll(/['"]([A-Za-z_]+)['"]/gu)].map((entry) => entry[1]),
  );
  for (const field of REQUIRED_FORBIDDEN_STORAGE_ROOT_FIELDS) {
    if (!declared.has(field)) {
      failures.push(
        `${relativePath}: renderer storage-root fail-closed assertion must forbid '${field}' `
        + '(platform forbidden_renderer_fields must stay fully enforced at the host)',
      );
    }
  }
}

// (1) Renderer payload storage-root injection.
// Single-key `storageRoot:` / `storage_root:` object properties are the exact
// shape the removed SDK `attach*` helpers produced for renderer -> host command
// payloads. Desktop's legitimate `storageRoots` (plural) Runtime-projection
// display is a different identifier and is not matched.
const RENDERER_STORAGE_ROOT_KEY = /(?<![A-Za-z0-9_])(?:storageRoot|storage_root)\s*:/u;

// (2) Electron IPC handlers must not convert local paths to raw file:// URLs for
// renderer consumption. `pathToFileURL` is only allowed for loading the app's own
// packaged renderer entry into a BrowserWindow.
const RAW_FILE_URL_CALL = /pathToFileURL\s*\(/u;
const RENDERER_DIST_CONTEXT = /rendererDist|distIndex|distUrl|loadURL/u;

for (const appName of apps) {
  const rendererRoot = path.join(repoRoot, 'apps', appName, 'src');
  for (const file of collectSourceFiles(rendererRoot)) {
    const relative = slash(path.relative(repoRoot, file));
    const content = readFileSync(file, 'utf8');
    for (const [index, line] of content.split('\n').entries()) {
      if (RENDERER_STORAGE_ROOT_KEY.test(line)) {
        failures.push(
          `${relative}:${index + 1}: renderer command payloads must not carry a storageRoot/storage_root field; `
          + 'use relative-path-only standard shell storage (host owns the Runtime-attested root)',
        );
      }
    }
  }

  const electronRoot = path.join(repoRoot, 'apps', appName, 'src-electron');
  for (const file of collectSourceFiles(electronRoot)) {
    const relative = slash(path.relative(repoRoot, file));
    const content = readFileSync(file, 'utf8');
    for (const [index, line] of content.split('\n').entries()) {
      if (RAW_FILE_URL_CALL.test(line) && !RENDERER_DIST_CONTEXT.test(line)) {
        failures.push(
          `${relative}:${index + 1}: Electron host must not build raw file:// URLs for renderer-facing values; `
          + 'serve local assets through the kit standard shell file protocol host (localAssetProtocolHost)',
        );
      }
    }
  }
}

if (failures.length > 0) {
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log('check-standard-shell-payload-fields passed');

function collectSourceFiles(root) {
  if (!existsSync(root)) {
    return [];
  }
  const files = [];
  walk(root, files);
  return files;
}

function walk(target, files) {
  const stat = statSync(target);
  if (stat.isDirectory()) {
    for (const entry of readdirSync(target)) {
      if (entry === 'node_modules' || entry === 'dist' || entry === 'dist-electron' || entry === '__snapshots__') {
        continue;
      }
      walk(path.join(target, entry), files);
    }
    return;
  }
  if (/\.(?:test|spec)\.(?:ts|tsx|js|mjs|cts)$/u.test(target)) {
    return;
  }
  if (/\.(?:ts|tsx|js|mjs|cts)$/u.test(target)) {
    files.push(target);
  }
}

function slash(value) {
  return value.replace(/\\/gu, '/');
}
