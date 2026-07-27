#!/usr/bin/env node
/* global console, process */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

const allowedCommands = new Set([
  'runtime_local_pick_asset_manifest_path',
]);

const allowedLocalRuntimeFiles = new Set([
  'mod.rs',
  ['commands', 'mod.rs'].join(sep),
]);

const scanSpecs = [
  {
    label: 'Tauri command definition',
    file: 'apps/desktop/src-tauri/src/local_runtime/commands/mod.rs',
    pattern: /\bpub\s+fn\s+(runtime_local_[a-z0-9_]+)/gu,
  },
  {
    label: 'Tauri command registration',
    file: 'apps/desktop/src-tauri/src/main_parts/app_bootstrap.rs',
    pattern: /\blocal_runtime::commands::(runtime_local_[a-z0-9_]+)/gu,
  },
  {
    label: 'Desktop IPC command configuration',
    file: 'config/desktop-ipc-commands.yaml',
    pattern: /^\s*-\s+command:\s*(runtime_local_[a-z0-9_]+)\s*$/gmu,
  },
  {
    label: 'Desktop renderer runtime_local invoke',
    dir: 'apps/desktop/src',
    extensions: new Set(['.ts', '.tsx']),
    pattern:
      /\b(?:invokeLocalRuntimeCommand|invokeLocalAiCommand|tauriInvoke)(?:<[^>]+>)?\(\s*['"`](runtime_local_[a-z0-9_]+)['"`]/gu,
  },
];

function collectFiles(root, extensions) {
  const files = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const full = join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectFiles(full, extensions));
      continue;
    }
    if (!extensions || extensions.has(full.slice(full.lastIndexOf('.')))) {
      files.push(full);
    }
  }
  return files;
}

function lineForIndex(source, index) {
  return source.slice(0, index).split('\n').length;
}

function scanSource({ label, file, source, pattern }, violations) {
  for (const match of source.matchAll(pattern)) {
    const command = match[1];
    if (!allowedCommands.has(command)) {
      violations.push({
        label,
        file,
        line: lineForIndex(source, match.index ?? 0),
        command,
      });
    }
  }
}

function scanLocalRuntimeFiles(violations) {
  const root = join(repoRoot, 'apps/desktop/src-tauri/src/local_runtime');
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    violations.push({
      label: 'local_runtime directory',
      file: relative(repoRoot, root),
      line: 1,
      command: 'missing local_runtime helper module',
    });
    return;
  }

  for (const file of collectFiles(root)) {
    const rel = relative(root, file);
    if (!allowedLocalRuntimeFiles.has(rel)) {
      violations.push({
        label: 'local_runtime shipped file',
        file: relative(repoRoot, file),
        line: 1,
        command: 'non-helper local_runtime file',
      });
    }
  }
}

function main() {
  const violations = [];
  scanLocalRuntimeFiles(violations);

  for (const spec of scanSpecs) {
    if (spec.file) {
      const absolute = join(repoRoot, spec.file);
      const source = readFileSync(absolute, 'utf8');
      scanSource({ ...spec, file: spec.file, source }, violations);
      continue;
    }

    const root = join(repoRoot, spec.dir);
    for (const file of collectFiles(root, spec.extensions)) {
      const source = readFileSync(file, 'utf8');
      scanSource({
        ...spec,
        file: relative(repoRoot, file),
        source,
      }, violations);
    }
  }

  if (violations.length > 0) {
    console.error('Desktop runtime_local_* commands are limited to the admitted manifest picker helper.');
    for (const item of violations) {
      console.error(` - ${item.file}:${item.line} [${item.label}] ${item.command}`);
    }
    process.exit(1);
  }

  console.log('check:desktop-local-runtime-helper-boundary: admitted manifest picker helper only');
}

main();
