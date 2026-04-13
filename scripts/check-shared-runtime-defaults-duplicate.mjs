#!/usr/bin/env node

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const appsRoot = path.join(repoRoot, 'apps');

const MAIN_WIRING_PATTERN = /use\s+nimi_kit_shell_tauri::runtime_defaults\s+as\s+defaults\s*;/;

async function exists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const appEntries = await fs.readdir(appsRoot, { withFileTypes: true });
  const violations = [];

  for (const entry of appEntries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const appRoot = path.join(appsRoot, entry.name);
    const mainPath = path.join(appRoot, 'src-tauri', 'src', 'main.rs');
    const defaultsPath = path.join(appRoot, 'src-tauri', 'src', 'defaults.rs');
    if (!(await exists(mainPath))) {
      continue;
    }

    const mainSource = await fs.readFile(mainPath, 'utf8');
    if (!MAIN_WIRING_PATTERN.test(mainSource)) {
      continue;
    }
    if (await exists(defaultsPath)) {
      violations.push(path.relative(repoRoot, defaultsPath));
    }
  }

  if (violations.length > 0) {
    process.stderr.write('shared runtime_defaults duplicate check failed:\n');
    for (const violation of violations) {
      process.stderr.write(`- ${violation} must be deleted because the app already wires nimi_kit_shell_tauri::runtime_defaults\n`);
    }
    process.exitCode = 1;
    return;
  }

  process.stdout.write('shared runtime_defaults duplicate check passed\n');
}

main().catch((error) => {
  process.stderr.write(`check-shared-runtime-defaults-duplicate failed: ${String(error)}\n`);
  process.exitCode = 1;
});
