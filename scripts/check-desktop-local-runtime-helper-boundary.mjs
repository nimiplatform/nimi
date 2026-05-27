#!/usr/bin/env node
/* global console, process */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

const allowedCommands = new Set([
  'runtime_local_pick_asset_manifest_path',
  'runtime_local_pick_asset_file',
  'runtime_local_pick_asset_directory',
  'runtime_local_assets_reveal_in_folder',
  'runtime_local_assets_reveal_root_folder',
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
    label: 'Desktop IPC command table',
    file: '.nimi/spec/desktop/kernel/tables/ipc-commands.yaml',
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

function isSelfTest() {
  return process.argv.includes('--self-test');
}

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

function runSelfTest() {
  const violations = [];
  scanSource({
    label: 'self-test',
    file: 'synthetic.ts',
    source: `
      invokeLocalRuntimeCommand('runtime_local_pick_asset_file');
      invokeLocalRuntimeCommand('runtime_local_assets_import');
      tauriInvoke('runtime_local_recommendation_feed_get');
    `,
    pattern:
      /\b(?:invokeLocalRuntimeCommand|invokeLocalAiCommand|tauriInvoke)(?:<[^>]+>)?\(\s*['"`](runtime_local_[a-z0-9_]+)['"`]/gu,
  }, violations);

  const observed = violations.map((entry) => entry.command).sort();
  const expected = ['runtime_local_assets_import', 'runtime_local_recommendation_feed_get'].sort();
  if (JSON.stringify(observed) !== JSON.stringify(expected)) {
    console.error('check:desktop-local-runtime-helper-boundary self-test failed');
    console.error(`expected ${JSON.stringify(expected)}, got ${JSON.stringify(observed)}`);
    process.exit(1);
  }
  console.log('check:desktop-local-runtime-helper-boundary self-test: OK');
}

function main() {
  if (isSelfTest()) {
    runSelfTest();
    return;
  }

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
    console.error('Desktop runtime_local_* commands are limited to picker/reveal shell helpers.');
    for (const item of violations) {
      console.error(` - ${item.file}:${item.line} [${item.label}] ${item.command}`);
    }
    process.exit(1);
  }

  console.log('check:desktop-local-runtime-helper-boundary: admitted picker/reveal helpers only');
}

main();
