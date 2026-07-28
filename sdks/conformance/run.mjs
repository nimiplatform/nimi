#!/usr/bin/env node

import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '../..');
const languages = ['typescript', 'python', 'go', 'rust'];

function parseLanguageArg() {
  const idx = process.argv.indexOf('--language');
  if (idx === -1) return languages;
  const value = process.argv[idx + 1];
  if (!value) {
    throw new Error('--language requires a value');
  }
  const selected = value === 'all'
    ? languages
    : value.split(',').map((item) => item.trim()).filter(Boolean);
  for (const language of selected) {
    if (!languages.includes(language)) {
      throw new Error(`unsupported language: ${language}`);
    }
  }
  return selected;
}

function assertTypedCoreProfile() {
  const idx = process.argv.indexOf('--profile');
  if (idx === -1) return;
  const value = process.argv[idx + 1];
  if (!value) {
    throw new Error('--profile requires a value');
  }
  if (value !== 'typed-core') {
    throw new Error(`unsupported conformance profile: ${value}`);
  }
}

function run(command, args, options = {}) {
  execFileSync(command, args, {
    cwd: repoRoot,
    stdio: 'inherit',
    env: { ...process.env, ...(options.env || {}) },
  });
}

function runPnpm(args, options = {}) {
  if (process.platform !== 'win32') {
    run('pnpm', args, options);
    return;
  }
  run('cmd.exe', ['/d', '/c', 'pnpm', ...args], options);
}

function runTypescriptBehavior() {
  runPnpm([
    '--filter',
    '@nimiplatform/sdk',
    'exec',
    'tsx',
    '../conformance/behavior/typescript.ts',
  ]);
}

function runPythonBehavior() {
  run(process.platform === 'win32' ? 'python' : 'python3', ['sdks/conformance/behavior/python.py'], {
    env: { PYTHONPATH: repoRoot },
  });
}

function runGoBehavior() {
  const dir = mkdtempSync(path.join(tmpdir(), 'sdks-go-conformance-'));
  try {
    cpSync(path.join(repoRoot, 'sdks/go'), dir, { recursive: true });
    cpSync(
      path.join(repoRoot, 'sdks/conformance'),
      path.join(dir, 'conformance'),
      { recursive: true },
    );
    execFileSync('go', ['mod', 'init', 'github.com/nimiplatform/nimi/sdks/go'], {
      cwd: dir,
      stdio: 'ignore',
    });
    execFileSync('go', [
      'test',
      './coregenerated',
      '-run',
      '^TestTypedRuntimeClientsPreserveRequestsAndTransportBehavior$',
    ], {
      cwd: dir,
      stdio: 'inherit',
      env: process.env,
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function runRustBehavior() {
  const dir = mkdtempSync(path.join(tmpdir(), 'sdks-rust-conformance-'));
  try {
    cpSync(path.join(repoRoot, 'sdks/rust/core_client'), path.join(dir, 'core_client'), { recursive: true });
    cpSync(path.join(repoRoot, 'sdks/rust/core_generated'), path.join(dir, 'core_generated'), { recursive: true });
    cpSync(path.join(repoRoot, 'sdks/rust/realm'), path.join(dir, 'realm'), { recursive: true });
    cpSync(path.join(repoRoot, 'sdks/rust/runtime'), path.join(dir, 'runtime'), { recursive: true });
    cpSync(path.join(repoRoot, 'sdks/rust/types'), path.join(dir, 'types'), { recursive: true });
    cpSync(path.join(repoRoot, 'sdks/conformance/behavior/rust.rs'), path.join(dir, 'behavior.rs'));
    writeFileSync(
      path.join(dir, 'lib.rs'),
      [
        'pub mod core_client;',
        'pub mod core_generated;',
        'pub mod realm;',
        'pub mod runtime;',
        'pub mod types;',
        '#[cfg(test)] mod behavior { include!("behavior.rs"); }',
        '',
      ].join('\n'),
      'utf8',
    );
    const outputName = process.platform === 'win32' ? 'sdks_rust_behavior_test.exe' : 'sdks_rust_behavior_test';
    const outputPath = path.join(dir, outputName);
    execFileSync('rustc', ['--crate-type', 'lib', '--test', path.join(dir, 'lib.rs'), '-o', outputPath], {
      cwd: dir,
      stdio: 'inherit',
    });
    execFileSync(outputPath, [], {
      cwd: dir,
      stdio: 'inherit',
      env: process.env,
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function runBehavior(language) {
  switch (language) {
    case 'typescript':
      runTypescriptBehavior();
      return;
    case 'python':
      runPythonBehavior();
      return;
    case 'go':
      runGoBehavior();
      return;
    case 'rust':
      runRustBehavior();
      return;
    default:
      throw new Error(`unknown behavior language: ${language}`);
  }
}

function main() {
  const selected = parseLanguageArg();
  assertTypedCoreProfile();
  for (const language of selected) {
    runBehavior(language);
  }
  process.stdout.write(`sdks conformance: OK (${selected.join(', ')})\n`);
}

try {
  main();
} catch (error) {
  process.stderr.write(`[sdks:conformance] ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}
