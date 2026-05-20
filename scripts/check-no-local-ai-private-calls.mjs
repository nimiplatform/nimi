#!/usr/bin/env node
/* global console, process */
/**
 * check:no-local-ai-private-calls
 *
 * Forbids desktop renderer TypeScript from calling private `local_ai_*` Tauri
 * commands directly. Private local-AI lifecycle must go through the runtime
 * bridge APIs (`runtime.local.*`), never a raw `invoke('local_ai_*')`.
 *
 * Real intent: block private-command CALL SITES. It must NOT flag the
 * spec-admitted first-run product-control STATE-name literals
 * (`local_ai_ready`, `local_ai_profile_selected_*`,
 * `local_ai_assets_downloaded_environment_not_ready`, ...) which are canonical
 * `first-run-state-machine.yaml` discriminator values, not command names.
 *
 * Detection is therefore anchored to the invoke surface: a violation is a
 * `local_ai_*` string literal passed as the FIRST argument to an
 * `invoke` / `invokeChecked` / `invokeTauri` call.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const scanRoot = join(repoRoot, 'apps/desktop/src');
const SCAN_EXTENSIONS = ['.ts', '.tsx'];

// `invoke('local_ai_foo'`, `invokeChecked("local_ai_foo"`, `invokeTauri(`local_ai_foo``.
// The invoke-family identifier, optional whitespace, `(`, optional whitespace,
// a quote, then a `local_ai_*` command token. This matches the private-command
// call surface and never matches a bare state-name literal in a union type,
// array, or comparison.
const PRIVATE_CALL_PATTERN =
  /\b(?:invoke|invokeChecked|invokeTauri)\s*\(\s*['"`]local_ai_[a-z0-9_]+['"`]/;

function collectFiles(dir) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectFiles(full));
      continue;
    }
    if (SCAN_EXTENSIONS.some((ext) => entry.name.endsWith(ext))) {
      files.push(full);
    }
  }
  return files;
}

function main() {
  let scanStat;
  try {
    scanStat = statSync(scanRoot);
  } catch {
    console.error(`check:no-local-ai-private-calls: scan root missing: ${scanRoot}`);
    process.exit(1);
  }
  if (!scanStat.isDirectory()) {
    console.error(`check:no-local-ai-private-calls: scan root is not a directory: ${scanRoot}`);
    process.exit(1);
  }

  const violations = [];
  for (const file of collectFiles(scanRoot)) {
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, index) => {
      if (PRIVATE_CALL_PATTERN.test(line)) {
        violations.push({
          file: relative(repoRoot, file),
          line: index + 1,
          text: line.trim(),
        });
      }
    });
  }

  if (violations.length > 0) {
    console.error('desktop TS private local_ai_* Tauri command calls are forbidden; use runtime.local.* bridge APIs');
    for (const violation of violations) {
      console.error(` - ${violation.file}:${violation.line} -> ${violation.text}`);
    }
    process.exit(1);
  }

  console.log('check:no-local-ai-private-calls: no private local_ai_* command call sites found');
  process.exit(0);
}

main();
