#!/usr/bin/env node

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const SOURCE_ROOTS = [
  'apps/desktop/src',
  'apps/desktop/src-tauri/src',
];
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.rs']);
const SKIP_DIRS = new Set(['node_modules', 'dist', 'target', '.git']);
// K-CFG-001: canonical runtime config is ~/.nimi/runtime/config.json. The
// root-level ~/.nimi/config.json is retired and may only be read as explicit
// migration input, never advertised as a desktop config path.
const LEGACY_RUNTIME_CONFIG_PATH = /\.nimi\/config\.json/g;

function toRepoRelative(filePath) {
  return path.relative(repoRoot, filePath).replaceAll(path.sep, '/');
}

function getLineColumn(source, index) {
  const prefix = source.slice(0, index);
  const line = prefix.split('\n').length;
  const lastBreak = prefix.lastIndexOf('\n');
  const column = index - lastBreak;
  return { line, column };
}

async function collectSourceFiles(dir) {
  const files = [];
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return files;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) {
      continue;
    }
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectSourceFiles(fullPath));
      continue;
    }
    if (entry.isFile() && SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
      files.push(fullPath);
    }
  }
  return files;
}

async function main() {
  const files = [];
  for (const rel of SOURCE_ROOTS) {
    files.push(...await collectSourceFiles(path.join(repoRoot, rel)));
  }
  const violations = [];
  for (const file of files) {
    const source = await fs.readFile(file, 'utf8');
    LEGACY_RUNTIME_CONFIG_PATH.lastIndex = 0;
    let match = LEGACY_RUNTIME_CONFIG_PATH.exec(source);
    while (match) {
      const { line, column } = getLineColumn(source, match.index);
      violations.push(`${toRepoRelative(file)}:${line}:${column}`);
      match = LEGACY_RUNTIME_CONFIG_PATH.exec(source);
    }
  }
  if (violations.length > 0) {
    process.stderr.write('legacy desktop runtime config fallback path is forbidden; use ~/.nimi/runtime/config.json only\n');
    for (const violation of violations) {
      process.stderr.write(`- ${violation}\n`);
    }
    process.exitCode = 1;
    return;
  }
  process.stdout.write(`desktop legacy runtime config path check passed (${files.length} files scanned)\n`);
}

main().catch((error) => {
  process.stderr.write(`check-desktop-no-legacy-runtime-config-path failed: ${String(error)}\n`);
  process.exitCode = 1;
});
